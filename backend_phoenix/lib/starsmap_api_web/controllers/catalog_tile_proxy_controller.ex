defmodule StarsmapApiWeb.CatalogTileProxyController do
  use StarsmapApiWeb, :controller

  require Logger

  @manifest_name "manifest.json"

  def show(conn, %{"path" => path}) when is_list(path) do
    with {:ok, upstream_url} <- upstream_url(path),
         {:ok, status, headers, body} <- fetch_upstream(upstream_url) do
      conn
      |> put_proxy_headers(headers, path)
      |> send_resp(status, maybe_rewrite_manifest(body, path))
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

    case :hackney.request(:get, url, headers, <<>>, follow_redirect: true, recv_timeout: 30_000) do
      {:ok, status, response_headers, client_ref} ->
        case :hackney.body(client_ref) do
          {:ok, body} -> {:ok, status, response_headers, body}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp put_proxy_headers(conn, upstream_headers, path) do
    content_type = upstream_content_type(upstream_headers) || content_type_for_path(path)

    conn
    |> put_resp_content_type(content_type)
    |> put_resp_header("cache-control", "public, max-age=60")
    |> put_resp_header("access-control-allow-origin", "*")
  end

  defp upstream_content_type(headers) do
    headers
    |> Enum.find_value(fn {key, value} ->
      if String.downcase(to_string(key)) == "content-type", do: to_string(value)
    end)
  end

  defp content_type_for_path([@manifest_name]), do: "application/json"
  defp content_type_for_path(_path), do: "application/octet-stream"

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
