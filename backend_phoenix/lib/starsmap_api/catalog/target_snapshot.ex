defmodule StarsmapApi.Catalog.TargetSnapshot do
  @moduledoc "Immutable, explicitly shared results. Only server-signed match rows can be saved."
  import Ecto.Query
  alias StarsmapApi.Repo
  @salt "target-match-receipt-v1"
  @max_bytes 512_000
  @quota_bytes 100_000_000
  @quota_count 10_000
  def limits, do: %{payload_bytes: @max_bytes, total_bytes: @quota_bytes, snapshots: @quota_count}

  def receipt(rows) do
    # Drop full catalog payloads and unrelated metadata before signing or storing.
    rows = rows |> Jason.encode!() |> Jason.decode!() |> Enum.map(&sanitize_row/1)
    Phoenix.Token.sign(StarsmapApiWeb.Endpoint, @salt, rows)
  end

  defp verify(token) when is_binary(token) and byte_size(token) <= 1_000_000,
    do: Phoenix.Token.verify(StarsmapApiWeb.Endpoint, @salt, token, max_age: 3600)

  defp verify(_), do: {:error, :invalid_receipt}

  def prepare(%{"receipt" => receipt} = params) do
    with {:ok, rows} <- verify(receipt),
         true <- is_list(rows) and length(rows) in 1..500,
         selections when is_map(selections) and map_size(selections) <= 500 <-
           Map.get(params, "selections", %{}),
         {:ok, rows} <- apply_selections(rows, selections) do
      bytes = Jason.encode!(rows)

      if byte_size(bytes) <= @max_bytes do
        {:ok,
         %{
           "rows" => rows,
           "schema_version" => 1,
           "catalog_revision" =>
             "sha256:" <> Base.encode16(:crypto.hash(:sha256, bytes), case: :lower),
           "revision_note" =>
             "Digest of the retained catalog facts and source labels at matching time; not a global catalog release."
         }}
      else
        {:error, :too_large}
      end
    else
      _ -> {:error, :invalid_snapshot}
    end
  end

  def prepare(_), do: {:error, :invalid_snapshot}

  defp apply_selections(rows, selections) do
    Enum.reduce_while(selections, {:ok, rows}, fn {index, token}, {:ok, acc} ->
      with {i, ""} <- Integer.parse(index),
           true <- i >= 0 and i < length(rows),
           %{"status" => "ambiguous", "candidates" => candidates} <- Enum.at(rows, i),
           {:ok, [%{"status" => "matched", "object" => object} = selected]} <- verify(token),
           true <- Enum.any?(candidates, &(&1["key"] == object["key"])) do
        replacement =
          Enum.at(rows, i)
          |> Map.put("status", "matched")
          |> Map.put("object", object)
          |> Map.put("identity_key", selected["identity_key"] || object["key"])

        {:cont, {:ok, List.replace_at(acc, i, replacement)}}
      else
        _ -> {:halt, {:error, :invalid_selection}}
      end
    end)
    |> case do
      {:ok, rows} ->
        {rows, _} =
          Enum.map_reduce(Enum.with_index(rows), %{}, fn {row, index}, seen ->
            key = row["identity_key"] || get_in(row, ["object", "key"])
            row = Map.delete(row, "duplicate_of")

            cond do
              is_nil(key) -> {row, seen}
              Map.has_key?(seen, key) -> {Map.put(row, "duplicate_of", seen[key]), seen}
              true -> {row, Map.put(seen, key, index)}
            end
          end)

        {:ok, rows}

      error ->
        error
    end
  end

  def create(params) do
    with {:ok, payload} <- prepare(params) do
      now = DateTime.utc_now()
      payload = Map.put(payload, "created_at", DateTime.to_iso8601(now))
      bytes = byte_size(Jason.encode!(payload))

      Repo.transaction(fn ->
        # Serialize quota checks across processes and nodes. Existing links never expire.
        Ecto.Adapters.SQL.query!(Repo, "SELECT pg_advisory_xact_lock(1442026)", [])

        {count, used} =
          Repo.one(from s in "target_snapshots", select: {count(s.token), sum(s.bytes)})

        if count >= @quota_count or (used || 0) + bytes > @quota_bytes,
          do: Repo.rollback(:quota_full)

        token = :crypto.strong_rand_bytes(24) |> Base.url_encode64(padding: false)

        Repo.insert_all(
          "target_snapshots",
          [%{token: token, payload: payload, bytes: bytes, created_at: now, later_day_opens: 0}],
          log: false
        )

        %{token: token, payload: payload}
      end)
    end
  end

  def read(token, count_open \\ false) do
    if is_binary(token) and Regex.match?(~r/^[A-Za-z0-9_-]{32}$/, token) do
      case Repo.one(from(s in "target_snapshots", where: s.token == ^token, select: s.payload),
             log: false
           ) do
        nil ->
          {:error, :not_found}

        payload ->
          if count_open do
            today = Date.utc_today()

            Repo.update_all(
              from(s in "target_snapshots",
                where:
                  s.token == ^token and fragment("?::date < ?", s.created_at, ^today) and
                    (is_nil(s.last_open_date) or s.last_open_date < ^today)
              ),
              [set: [last_open_date: today], inc: [later_day_opens: 1]],
              log: false
            )
          end

          {:ok, payload}
      end
    else
      {:error, :not_found}
    end
  end

  defp sanitize_row(row) do
    row =
      Map.take(
        row,
        ~w(input status object candidates separation_arcsec duplicate_of reason identity_key)
      )

    row = if is_map(row["object"]), do: Map.update!(row, "object", &sanitize_object/1), else: row

    if is_list(row["candidates"]),
      do:
        Map.update!(row, "candidates", fn candidates ->
          Enum.map(candidates, &Map.take(&1, ~w(key name object_type catalog_group)))
        end),
      else: row
  end

  defp sanitize_object(object) do
    object =
      Map.take(
        object,
        ~w(key name object_type catalog_group source source_revision source_snapshot astrometry position)
      )

    source = object["source"] || %{}
    url = source["url"]
    source = Map.take(source, ["label", "url"])

    source =
      if is_binary(url) and URI.parse(url).scheme in ["https", "http"] and
           is_binary(URI.parse(url).host),
         do: source,
         else: Map.delete(source, "url")

    object
    |> Map.put("source", source)
    |> Map.update("astrometry", %{}, &Map.take(&1 || %{}, ~w(ra_deg dec_deg)))
    |> Map.update("position", %{}, &Map.take(&1 || %{}, ~w(x_au y_au)))
  end
end
