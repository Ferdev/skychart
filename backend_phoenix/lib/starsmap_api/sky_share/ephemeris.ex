defmodule StarsmapApi.SkyShare.Ephemeris do
  @moduledoc "Server-owned ephemeris access for Sky share resolution."

  @callback snapshot(DateTime.t(), [String.t()]) :: {:ok, map()} | {:error, term()}

  def snapshot(epoch, keys \\ []) do
    provider = Application.get_env(:starsmap_api, :sky_share_ephemeris_provider, __MODULE__.Http)
    provider.snapshot(epoch, keys)
  end

  defmodule Http do
    @behaviour StarsmapApi.SkyShare.Ephemeris
    @groups "core,mars_moons,jupiter_major_moons,saturn_major_moons"
    @timeout 20_000

    @impl true
    def snapshot(%DateTime{} = epoch, keys) when is_list(keys) do
      params = %{
        "timestamp" => DateTime.to_iso8601(epoch),
        "groups" => @groups,
        "keys" => Enum.join(keys, ",")
      }

      with {:ok, uri} <- target_uri(params),
           {:ok, 200, _headers, body} <-
             :hackney.get(URI.to_string(uri), [{"accept", "application/json"}], "",
               recv_timeout: @timeout,
               connect_timeout: 3_000
             ),
           {:ok, payload} <- Jason.decode(body),
           true <- is_list(payload["bodies"]) do
        {:ok, payload}
      else
        {:ok, status, _headers, _body} ->
          {:error, {:ephemeris_status, status}}

        false ->
          {:error, :invalid_ephemeris_payload}

        {:error, reason} ->
          {:error, reason}

        other ->
          {:error, other}
      end
    end

    def snapshot(_, _), do: {:error, :invalid_ephemeris_request}

    defp target_uri(params) do
      base =
        (System.get_env("PYTHON_BACKEND_URL") ||
           Application.get_env(:starsmap_api, :python_backend_url, "http://127.0.0.1:8765"))
        |> String.trim_trailing("/")

      uri = URI.parse(base <> "/api/ephemeris")

      if uri.scheme == "http" and is_binary(uri.host),
        do: {:ok, %{uri | query: URI.encode_query(params)}},
        else: {:error, :invalid_server_ephemeris_url}
    end
  end
end
