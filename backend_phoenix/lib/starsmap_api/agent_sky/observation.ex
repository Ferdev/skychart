defmodule StarsmapApi.AgentSky.Observation do
  @moduledoc "Server-owned access to the scientific service's ground-observer geometry."

  @callback observe(String.t(), float(), float()) :: {:ok, map()} | {:error, term()}

  def observe(key, latitude, longitude) do
    provider = Application.get_env(:starsmap_api, :agent_observation_provider, __MODULE__.Http)
    provider.observe(key, latitude, longitude)
  end

  defmodule Http do
    @behaviour StarsmapApi.AgentSky.Observation
    @timeout 20_000

    @impl true
    def observe(key, latitude, longitude)
        when is_binary(key) and is_float(latitude) and is_float(longitude) do
      params = %{"key" => key, "lat" => latitude, "lon" => longitude}

      with {:ok, uri} <- target_uri(params),
           {:ok, status, _headers, body} when is_binary(body) <-
             :hackney.get(URI.to_string(uri), [{"accept", "application/json"}], "",
               recv_timeout: @timeout,
               connect_timeout: 3_000
             ) do
        case {status, Jason.decode(body)} do
          {200, {:ok, %{"altitude_deg" => _} = payload}} -> {:ok, payload}
          # The service answers 400 for a key that it does not model.
          {400, _} -> {:error, :not_modeled}
          {status, _} -> {:error, {:observation_status, status}}
        end
      else
        {:error, reason} -> {:error, reason}
        other -> {:error, other}
      end
    end

    def observe(_, _, _), do: {:error, :invalid_observation_request}

    defp target_uri(params) do
      base =
        (System.get_env("PYTHON_BACKEND_URL") ||
           Application.get_env(:starsmap_api, :python_backend_url, "http://127.0.0.1:8765"))
        |> String.trim_trailing("/")

      uri = URI.parse(base <> "/api/observe")

      if uri.scheme == "http" and is_binary(uri.host),
        do: {:ok, %{uri | query: URI.encode_query(params)}},
        else: {:error, :invalid_observation_url}
    end
  end
end
