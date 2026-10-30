defmodule StarsmapApi.Catalog.TargetMatch do
  @moduledoc """
  A bounded cross-match of a target list against the catalog semantic index.

  A row is a name, an object key, or a J2000 position. A name uses the ranked catalog
  search; a position uses the nearest object on the sky. The list is not stored.
  """

  import Ecto.Query

  alias StarsmapApi.Catalog.{CatalogSourceObject, PublicObjects, Search}
  alias StarsmapApi.Community.Subjects
  alias StarsmapApi.Repo

  @max_rows 500
  @default_radius_arcmin 5.0
  @max_radius_arcmin 60.0
  @search_limit 5
  @concurrency 4
  @time_budget_ms 20_000
  @r :math.pi() / 180

  def max_rows, do: @max_rows

  @doc """
  Matches the rows. The result has one entry for each row, in the order of the request.
  `max_rows` lets a transport set a smaller bound.
  """
  def run(rows, options \\ []) do
    limit = Keyword.get(options, :max_rows, @max_rows)

    cond do
      not is_list(rows) or rows == [] ->
        {:error, :invalid_rows}

      length(rows) > limit ->
        {:error, {:too_many_rows, limit}}

      true ->
        radius = radius_arcmin(Keyword.get(options, :radius_arcmin))
        deadline = System.monotonic_time(:millisecond) + @time_budget_ms

        matched =
          rows
          |> Enum.map(&normalize/1)
          |> resolve(radius, deadline)
          |> mark_duplicates()

        {:ok,
         %{
           rows: matched,
           radius_arcmin: radius,
           counts: Enum.frequencies_by(matched, & &1.status),
           limit: limit
         }}
    end
  end

  defp radius_arcmin(value) when is_number(value) and value > 0,
    do: min(value * 1.0, @max_radius_arcmin)

  defp radius_arcmin(_), do: @default_radius_arcmin

  defp normalize(%{"ra_deg" => ra, "dec_deg" => dec})
       when is_number(ra) and is_number(dec) and ra >= 0 and ra <= 360 and dec >= -90 and
              dec <= 90,
       do: %{kind: :position, ra: ra * 1.0, dec: dec * 1.0, input: "#{ra} #{dec}"}

  defp normalize(%{"key" => key}) when is_binary(key) and byte_size(key) in 1..180,
    do: %{kind: :key, key: key, input: key}

  defp normalize(%{"name" => name}) when is_binary(name) do
    case String.trim(name) do
      text when byte_size(text) in 1..120 -> %{kind: :name, name: text, input: text}
      _ -> %{kind: :invalid, input: String.slice(name, 0, 120)}
    end
  end

  defp normalize(_), do: %{kind: :invalid, input: ""}

  # Identical inputs are one lookup. Designations share one indexed query, and only the other
  # names use the search, which is the expensive step.
  defp resolve(rows, radius, deadline) do
    unique = Enum.uniq_by(rows, &lookup_id/1)
    keyed = by_key(unique)

    results =
      unique
      |> Task.async_stream(
        fn row -> {lookup_id(row), lookup(row, keyed, radius, deadline)} end,
        max_concurrency: @concurrency,
        timeout: @time_budget_ms + 5_000,
        on_timeout: :kill_task
      )
      |> Enum.flat_map(fn
        {:ok, result} -> [result]
        {:exit, _reason} -> []
      end)
      |> Map.new()

    rows
    |> Enum.with_index()
    |> Enum.map(fn {row, index} ->
      Map.get(results, lookup_id(row), unmatched())
      |> Map.merge(%{row: index, input: row.input, kind: row.kind})
    end)
  end

  defp lookup_id(%{kind: :position, ra: ra, dec: dec}), do: {:position, ra, dec}
  defp lookup_id(%{kind: :invalid, input: input}), do: {:invalid, input}
  defp lookup_id(%{kind: :key, key: key}), do: {:key, key}
  defp lookup_id(%{name: name}), do: {:name, String.downcase(name)}

  defp by_key(rows) do
    keys =
      rows
      |> Enum.flat_map(fn
        %{kind: :key, key: key} -> [key]
        %{kind: :name, name: name} -> designation_keys(name)
        _ -> []
      end)
      |> Enum.uniq()

    if keys == [],
      do: %{},
      else:
        Repo.all(from o in CatalogSourceObject, where: o.key in ^keys)
        |> Map.new(&{&1.key, &1})
  end

  @doc false
  def designation_keys(name) do
    text = name |> String.downcase() |> String.trim()

    case Regex.run(~r/^(m|messier|ngc|ic|hip)[\s._-]*0*(\d+)$/, text) do
      [_, prefix, number] when prefix in ["m", "messier"] -> ["m#{number}"]
      [_, prefix, number] -> ["#{prefix}-#{number}"]
      nil -> [text]
    end
  end

  defp lookup(%{kind: :invalid}, _keyed, _radius, _deadline),
    do: %{status: "unmatched", reason: "invalid_row"}

  defp lookup(%{kind: :key, key: key}, keyed, _radius, _deadline) do
    case keyed[key] do
      nil -> unmatched()
      object -> matched(object)
    end
  end

  defp lookup(%{kind: :position} = row, _keyed, radius, deadline) do
    if expired?(deadline), do: out_of_time(), else: nearest(row, radius)
  end

  defp lookup(%{kind: :name, name: name}, keyed, _radius, deadline) do
    case Enum.find_value(designation_keys(name), &keyed[&1]) do
      nil ->
        if expired?(deadline), do: out_of_time(), else: search(name)

      object ->
        matched(object)
    end
  end

  defp search(name) do
    objects =
      Search.search(%{"q" => name, "limit" => "#{@search_limit}"}).objects
      |> Enum.uniq_by(&identity(&1.key))

    needle = String.downcase(name)

    exact =
      Enum.filter(objects, fn object ->
        Enum.any?([object.name, object.key | object.aliases], &(String.downcase(&1) == needle))
      end)

    case {exact, objects} do
      {[object], _} -> matched_payload(object)
      {_, []} -> unmatched()
      {_, [object]} -> matched_payload(object)
      {[], candidates} -> ambiguous(candidates)
      {candidates, _} -> ambiguous(candidates)
    end
  end

  defp nearest(%{ra: ra, dec: dec}, radius) do
    degrees = radius / 60
    ra_margin = min(degrees / max(:math.cos(min(abs(dec) + degrees, 89.9) * @r), 0.002), 180.0)

    candidates =
      ra_ranges(ra, ra_margin)
      |> Enum.flat_map(fn {low, high} ->
        Repo.all(
          from o in CatalogSourceObject,
            where:
              o.dec_deg >= ^(dec - degrees) and o.dec_deg <= ^(dec + degrees) and
                o.ra_deg >= ^low and o.ra_deg <= ^high,
            limit: 2_000
        )
      end)

    candidates
    |> Enum.map(&{&1, separation_arcsec(ra, dec, &1.ra_deg, &1.dec_deg)})
    |> Enum.filter(fn {_object, separation} -> separation <= radius * 60 end)
    |> Enum.min_by(fn {object, separation} -> {separation, object.key} end, fn -> nil end)
    |> case do
      nil -> unmatched()
      {object, separation} -> Map.put(matched(object), :separation_arcsec, separation)
    end
  end

  defp ra_ranges(ra, margin) do
    low = ra - margin
    high = ra + margin

    cond do
      margin >= 180 -> [{0.0, 360.0}]
      low < 0 -> [{low + 360, 360.0}, {0.0, high}]
      high > 360 -> [{low, 360.0}, {0.0, high - 360}]
      true -> [{low, high}]
    end
  end

  @doc "The angle between two J2000 positions, by the haversine form for small angles."
  def separation_arcsec(ra1, dec1, ra2, dec2) do
    a =
      :math.sin((dec2 - dec1) * @r / 2) ** 2 +
        :math.cos(dec1 * @r) * :math.cos(dec2 * @r) * :math.sin((ra2 - ra1) * @r / 2) ** 2

    2 * :math.asin(:math.sqrt(min(a, 1.0))) / @r * 3600
  end

  # The key of an object in the identity groups, so that its Messier and OpenNGC rows are one object.
  defp identity(key), do: key |> Subjects.keys() |> Enum.min()

  defp matched(%CatalogSourceObject{} = object),
    do: matched_payload(PublicObjects.catalog_object_payload(object))

  defp matched_payload(payload),
    do: %{status: "matched", object: Map.put(payload, :source, source(payload.source))}

  # The full source record of a catalog is large, and a list has hundreds of rows.
  defp source(record) do
    first =
      case record["provenance"] || record["source"] do
        [entry | _] -> entry
        %{} = entry -> entry
        _ -> record
      end

    %{label: first["label"] || record["catalog"], url: first["url"]}
  end

  defp ambiguous(candidates) do
    %{
      status: "ambiguous",
      candidates: Enum.map(candidates, &Map.take(&1, [:key, :name, :object_type, :catalog_group]))
    }
  end

  defp unmatched, do: %{status: "unmatched"}
  defp out_of_time, do: %{status: "unmatched", reason: "time_budget"}
  defp expired?(deadline), do: System.monotonic_time(:millisecond) > deadline

  # Two rows can resolve to one object: an alias and a designation, the same name two times,
  # or the Messier and the OpenNGC rows of one object, which the identity groups connect.
  defp mark_duplicates(rows) do
    {marked, _seen} =
      Enum.map_reduce(rows, %{}, fn row, seen ->
        key = row[:object] && identity(row.object.key)

        cond do
          is_nil(key) -> {row, seen}
          Map.has_key?(seen, key) -> {Map.put(row, :duplicate_of, seen[key]), seen}
          true -> {row, Map.put(seen, key, row.row)}
        end
      end)

    marked
  end
end
