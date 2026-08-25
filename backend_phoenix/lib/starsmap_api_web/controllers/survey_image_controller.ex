defmodule StarsmapApiWeb.SurveyImageController do
  use StarsmapApiWeb, :controller

  require Logger

  @upstream_hosts [
    "https://alasky.cds.unistra.fr",
    "https://alaskybis.cds.unistra.fr"
  ]
  @hips_providers %{
    "dss2" => "CDS/P/DSS2/color",
    "allwise" => "CDS/P/allWISE/color"
  }

  def show(conn, params) do
    with {:ok, upstream_urls} <- upstream_urls(params),
         {:ok, response_headers, body} <- fetch_from_available_host(upstream_urls) do
      conn
      |> put_resp_content_type(upstream_content_type(response_headers))
      |> put_resp_header("cache-control", "public, max-age=86400, stale-if-error=604800")
      |> put_resp_header("access-control-allow-origin", "*")
      |> put_resp_header("content-disposition", "inline")
      |> send_resp(:ok, body)
    else
      {:error, :invalid_parameters} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "invalid survey image parameters"})

      {:error, reason} ->
        Logger.warning("Survey image providers unavailable: #{inspect(reason)}")

        conn
        |> put_status(:bad_gateway)
        |> put_resp_header("cache-control", "no-store")
        |> json(%{error: "survey image providers unavailable"})
    end
  end

  defp upstream_urls(%{
         "provider" => provider,
         "ra" => ra_param,
         "dec" => dec_param,
         "fov" => fov_param
       }) do
    with {:ok, ra} <- finite_float(ra_param),
         {:ok, dec} <- finite_float(dec_param),
         {:ok, fov} <- finite_float(fov_param),
         true <- ra >= 0 and ra < 360,
         true <- dec >= -90 and dec <= 90,
         true <- fov >= 0.01 and fov <= 5 do
      provider_urls(provider, ra, dec, fov)
    else
      _ -> {:error, :invalid_parameters}
    end
  end

  defp upstream_urls(_params), do: {:error, :invalid_parameters}

  defp provider_urls(provider, ra, dec, fov) when is_map_key(@hips_providers, provider) do
    query =
      URI.encode_query(%{
        "hips" => Map.fetch!(@hips_providers, provider),
        "width" => "512",
        "height" => "320",
        "fov" => decimal(fov),
        "projection" => "TAN",
        "coordsys" => "icrs",
        "ra" => decimal(ra),
        "dec" => decimal(dec),
        "format" => "jpg"
      })

    {:ok,
     Enum.map(@upstream_hosts, fn host ->
       host <> "/hips-image-services/hips2fits?" <> query
     end)}
  end

  defp provider_urls("legacy-dr11", ra, dec, fov) do
    query =
      URI.encode_query(%{
        "ra" => decimal(ra),
        "dec" => decimal(dec),
        "width" => "512",
        "height" => "320",
        "layer" => "ls-dr11",
        "pixscale" => decimal(fov * 3_600 / 512)
      })

    url = "https://www.legacysurvey.org/viewer/jpeg-cutout?" <> query
    {:ok, [url, url]}
  end

  defp provider_urls(_provider, _ra, _dec, _fov), do: {:error, :invalid_parameters}

  defp finite_float(value) when is_binary(value) do
    case Float.parse(value) do
      {number, ""} when number == number -> {:ok, number}
      _ -> {:error, :invalid_parameters}
    end
  end

  defp finite_float(_value), do: {:error, :invalid_parameters}

  defp decimal(number), do: :erlang.float_to_binary(number, decimals: 6)

  defp fetch_from_available_host(upstream_urls) do
    http_client = Application.get_env(:starsmap_api, :survey_image_http_client, :hackney)

    Enum.reduce_while(upstream_urls, {:error, :no_provider_available}, fn url, _last_error ->
      headers = [{"accept", "image/jpeg,image/*;q=0.9,*/*;q=0.1"}]

      result =
        http_client.request(:get, url, headers, <<>>,
          pool: false,
          follow_redirect: true,
          connect_timeout: 3_000,
          recv_timeout: 8_000
        )

      case result do
        {:ok, 200, response_headers, body} when is_binary(body) and byte_size(body) > 0 ->
          if image_content_type?(response_headers) do
            {:halt, {:ok, response_headers, body}}
          else
            {:cont, {:error, :invalid_content_type}}
          end

        {:ok, status, _response_headers, _body} ->
          {:cont, {:error, {:upstream_status, status}}}

        {:error, reason} ->
          {:cont, {:error, reason}}

        unexpected ->
          {:cont, {:error, {:unexpected_upstream_response, unexpected}}}
      end
    end)
  end

  defp image_content_type?(headers),
    do:
      headers
      |> upstream_content_type()
      |> String.starts_with?("image/")

  defp upstream_content_type(headers) do
    Enum.find_value(headers, "image/jpeg", fn {key, value} ->
      if String.downcase(to_string(key)) == "content-type", do: to_string(value)
    end)
  end
end
