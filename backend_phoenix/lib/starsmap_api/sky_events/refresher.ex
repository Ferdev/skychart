defmodule StarsmapApi.SkyEvents.Refresher do
  use GenServer
  require Logger
  alias StarsmapApi.SkyEvents
  @day 86_400_000
  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def init(opts) do
    state = %{
      fetcher: Keyword.get(opts, :fetcher, &fetch/1),
      interval: Keyword.get(opts, :interval, @day),
      jitter_seed: Keyword.get(opts, :jitter_seed, 0)
    }

    schedule(Keyword.get(opts, :initial_delay, 5_000))
    {:ok, state}
  end

  def handle_info(:refresh, state) do
    case refresh(state.fetcher) do
      {:ok, n} ->
        Logger.info("sky events refreshed count=#{n}")

      {:error, reason} ->
        Logger.error("sky events refresh failed: #{inspect(reason)}")
        Sentry.capture_message("sky events refresh failed", extra: %{reason: inspect(reason)})
    end

    schedule(
      state.interval + rem(:erlang.phash2({Date.utc_today(), state.jitter_seed}), 1_800_001)
    )

    {:noreply, state}
  end

  def refresh(fetcher \\ &fetch/1) do
    results = Enum.map([:cneos, :exoplanets], &{&1, fetch_source(fetcher, &1)})

    events =
      Enum.flat_map(results, fn
        {_source, {:ok, source_events}} -> source_events
        _ -> []
      end)

    failures =
      Enum.flat_map(results, fn
        {source, {:error, reason}} -> [{source, reason}]
        _ -> []
      end)

    Enum.each(failures, fn {source, reason} ->
      Logger.warning("sky events source failed source=#{source} reason=#{inspect(reason)}")
    end)

    if length(failures) == length(results),
      do: {:error, {:all_sources_failed, failures}},
      else: SkyEvents.upsert_all(events)
  end

  defp schedule(ms), do: Process.send_after(self(), :refresh, ms)

  def fetch(:cneos) do
    today = Date.utc_today()
    finish = Date.add(today, 30)

    url =
      "https://ssd-api.jpl.nasa.gov/cad.api?date-min=#{today}&date-max=#{finish}&dist-max=10LD"

    with {:ok, body} <- get(url),
         {:ok, data} <- Jason.decode(body),
         fields when is_list(fields) <- data["fields"],
         rows when is_list(rows) <- data["data"],
         do: {:ok, Enum.flat_map(rows, &parse_cneos(fields, &1))},
         else: (_ -> {:error, :invalid_cneos_response})
  end

  def fetch(:exoplanets) do
    since = Date.utc_today() |> Date.add(-30) |> Date.to_iso8601()

    query =
      URI.encode_query(%{
        "query" =>
          "select pl_name,hostname,disc_pubdate from ps where default_flag=1 and disc_pubdate >= '#{since}'",
        "format" => "json"
      })

    with {:ok, body} <- get("https://exoplanetarchive.ipac.caltech.edu/TAP/sync?#{query}"),
         {:ok, rows} when is_list(rows) <- Jason.decode(body),
         do: {:ok, Enum.flat_map(rows, &parse_exoplanet/1)},
         else: (_ -> {:error, :invalid_exoplanet_response})
  end

  defp get(url) do
    :hackney.request(:get, url, [{"accept", "application/json"}], "",
      recv_timeout: 15_000,
      follow_redirect: true
    )
    |> normalize_response()
  end

  @doc false
  def normalize_response({:ok, status, _headers, body})
      when status in 200..299 and is_binary(body),
      do: {:ok, body}

  def normalize_response({:ok, status, _headers, client_ref}) when status in 200..299,
    do: :hackney.body(client_ref)

  def normalize_response({:ok, status, _headers, _body}),
    do: {:error, {:upstream_status, status}}

  def normalize_response(error), do: error

  defp fetch_source(fetcher, source) do
    fetcher.(source)
  rescue
    error -> {:error, {:exception, Exception.message(error)}}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp parse_cneos(fields, row) when is_list(row) do
    v = Enum.zip(fields, row) |> Map.new()
    des = v["des"]

    with true <- is_binary(des) and byte_size(des) <= 80,
         {:ok, starts} <- parse_date(v["cd"]),
         {dist, ""} <- Float.parse(to_string(v["dist"] || "")),
         true <- dist <= 0.0257 do
      [
        %{
          source: "jpl_cneos",
          source_id: "#{des}:#{DateTime.to_iso8601(starts)}",
          kind: "close_approach",
          title: "#{des} close approach",
          summary: "Predicted approach at #{Float.round(dist / 0.00256956, 2)} lunar distances.",
          starts_at: starts,
          source_url: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=#{URI.encode(des)}",
          facts: %{"distance_au" => dist}
        }
      ]
    else
      _ -> []
    end
  end

  defp parse_cneos(_, _), do: []

  @doc false
  def parse_date(v) when is_binary(v) do
    months = %{
      "Jan" => "01",
      "Feb" => "02",
      "Mar" => "03",
      "Apr" => "04",
      "May" => "05",
      "Jun" => "06",
      "Jul" => "07",
      "Aug" => "08",
      "Sep" => "09",
      "Oct" => "10",
      "Nov" => "11",
      "Dec" => "12"
    }

    clean =
      Regex.replace(~r/^(\d{4})-([A-Za-z]{3})-/, v, fn _, y, m ->
        "#{y}-#{months[m] || "00"}-"
      end) <> ":00"

    case NaiveDateTime.from_iso8601(clean) do
      {:ok, dt} -> {:ok, DateTime.from_naive!(dt, "Etc/UTC")}
      _ -> :error
    end
  end

  def parse_date(_), do: :error

  @doc false
  def parse_exoplanet(%{"pl_name" => name, "hostname" => host, "disc_pubdate" => date})
      when is_binary(name) and is_binary(host) and is_binary(date) do
    with {:ok, day} <- parse_publication_date(date) do
      [
        %{
          source: "nasa_exoplanet_archive",
          source_id: name,
          kind: "new_exoplanet",
          title: "#{name} confirmed",
          summary: "Newly published confirmed planet orbiting #{host}.",
          starts_at: DateTime.new!(day, ~T[00:00:00], "Etc/UTC"),
          source_url: "https://exoplanetarchive.ipac.caltech.edu/overview/#{URI.encode(name)}",
          facts: %{"host" => host}
        }
      ]
    else
      _ -> []
    end
  end

  def parse_exoplanet(_), do: []

  defp parse_publication_date(<<year::binary-size(4), "-", month::binary-size(2)>>),
    do: Date.from_iso8601("#{year}-#{month}-01")

  defp parse_publication_date(value), do: Date.from_iso8601(String.slice(value, 0, 10))
end
