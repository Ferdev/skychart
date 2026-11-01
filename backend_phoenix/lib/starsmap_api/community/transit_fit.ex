defmodule StarsmapApi.Community.TransitFit do
  @moduledoc "The call to the transit fit of the Python service. The site is not part of it."

  @callback fit(String.t(), list()) :: {:ok, map()} | {:error, atom()}

  def fit(key, points),
    do:
      Application.get_env(:starsmap_api, :community_transit_fit, __MODULE__.Python).fit(
        key,
        points
      )

  defmodule Python do
    @moduledoc false
    @behaviour StarsmapApi.Community.TransitFit

    @impl true
    def fit(key, points) do
      base =
        (System.get_env("PYTHON_BACKEND_URL") ||
           Application.get_env(:starsmap_api, :python_backend_url, "http://127.0.0.1:8765"))
        |> String.trim_trailing("/")

      body = Jason.encode!(%{key: key, points: points})
      headers = [{"content-type", "application/json"}, {"accept", "application/json"}]

      with {:ok, status, _headers, response} when is_binary(response) <-
             :hackney.request(:post, base <> "/api/observe/transit-fit", headers, body,
               pool: false,
               connect_timeout: 3_000,
               recv_timeout: 30_000
             ),
           {:ok, decoded} <- Jason.decode(response) do
        cond do
          status == 200 -> {:ok, decoded}
          status == 400 -> {:error, :invalid_transit}
          true -> {:error, :transit_fit_unavailable}
        end
      else
        _ -> {:error, :transit_fit_unavailable}
      end
    end
  end
end
