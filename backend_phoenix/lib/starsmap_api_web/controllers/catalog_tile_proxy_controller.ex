defmodule StarsmapApiWeb.CatalogTileProxyController do
  use StarsmapApiWeb, :controller

  require Logger

  @manifest_name "manifest.json"

  def show(conn, %{"path" => path}) when is_list(path) do
    with {:ok, upstream_url} <- upstream_url(path),
         {:ok, status, headers, body} <- fetch_upstream(upstream_url) do
      conn
      |> put_proxy_headers(headers, path)
      |> send_proxied_response(status, body, path)
    else
      {:error, :not_configured} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "catalog tile proxy is not configured"})

      {:error, reason} ->
        Logger.warning("Catalog tile proxy failed: #{inspect(reason)}")

        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "catalog tile proxy failed"})
    end
  end

  defp upstream_url(path) do
    case catalog_tile_base_url() do
      "" -> {:error, :not_configured}
      base_url -> {:ok, base_url <> "/" <> Enum.map_join(path, "/", &URI.encode/1)}
    end
  end

  defp catalog_tile_base_url do
    "CATALOG_TILE_MANIFEST_URL"
    |> System.get_env("")
    |> String.trim()
    |> String.replace(~r{/manifest\.json\z}, "")
    |> String.trim_trailing("/")
  end

  defp fetch_upstream(url) do
    headers = [{"accept", "application/json,application/octet-stream;q=0.9,*/*;q=0.8"}]
    http_client = Application.get_env(:starsmap_api, :catalog_tile_http_client, :hackney)

    case http_client.request(:get, url, headers, <<>>,
           follow_redirect: true,
           recv_timeout: 30_000
         ) do
      {:ok, status, response_headers, body} when is_binary(body) ->
        {:ok, status, response_headers, body}

      {:error, reason} ->
        {:error, reason}

      unexpected ->
        {:error, {:unexpected_upstream_response, unexpected}}
    end
  end

  defp send_proxied_response(conn, status, body, path) when status in [403, 404] do
    if tile_path?(path) do
      conn
      |> put_resp_content_type("application/octet-stream")
      |> put_resp_header("x-starsmap-total", "0")
      |> put_resp_header("x-starsmap-returned", "0")
      |> send_resp(200, empty_smp2_tile())
    else
      send_resp(conn, status, maybe_rewrite_manifest(body, path))
    end
  end

  defp send_proxied_response(conn, status, body, path),
    do: send_resp(conn, status, maybe_rewrite_manifest(body, path))

  defp put_proxy_headers(conn, upstream_headers, path) do
    content_type = upstream_content_type(upstream_headers) || content_type_for_path(path)

    conn
    |> put_resp_content_type(content_type)
    |> put_resp_header("cache-control", cache_control_for_path(path))
    |> put_resp_header("access-control-allow-origin", "*")
  end

  @doc false
  def cache_control_for_path(path) do
    if tile_path?(path) do
      "public, max-age=31536000, immutable"
    else
      "no-store"
    end
  end

  defp upstream_content_type(headers) do
    headers
    |> Enum.find_value(fn {key, value} ->
      if String.downcase(to_string(key)) == "content-type", do: to_string(value)
    end)
  end

  defp content_type_for_path([@manifest_name]), do: "application/json"
  defp content_type_for_path(_path), do: "application/octet-stream"

  defp tile_path?(path), do: List.last(path) |> to_string() |> String.ends_with?(".bin")

  defp empty_smp2_tile, do: <<"SMP2", 0::little-unsigned-integer-size(32)>>

  defp maybe_rewrite_manifest(body, [@manifest_name]) do
    with {:ok, manifest} <- Jason.decode(body),
         true <- is_map(manifest) do
      manifest
      |> rewrite_tile_url_templates()
      |> Jason.encode!()
    else
      _ -> body
    end
  end

  defp maybe_rewrite_manifest(body, _path), do: body

  defp rewrite_tile_url_templates(manifest) do
    manifest
    |> Map.put("tile_url_template", "/catalog-tiles/v1/s{span_log2}/x{x}/y{y}.bin")
    |> Map.update("layers", [], fn layers ->
      Enum.map(layers, fn
        %{"id" => layer_id} = layer when is_binary(layer_id) ->
          Map.put(
            layer,
            "tile_url_template",
            "/catalog-tiles/v1/layers/#{layer_id}/s{span_log2}/x{x}/y{y}.bin"
          )

        layer ->
          layer
      end)
    end)
  end
end
