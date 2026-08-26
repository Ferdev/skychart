defmodule StarsmapApiWeb.CatalogController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Catalog.PointQueries
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Catalog.Search
  alias StarsmapApi.Catalog.SnapshotStore

  def summary(conn, _params) do
    json(conn, SnapshotStore.summary())
  end

  def search(conn, params) do
    json(conn, Search.search(params))
  end

  def viewport(conn, params) do
    case PointQueries.list_viewport(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def density(conn, params) do
    case PointQueries.density(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def points(conn, params) do
    case PointQueries.points(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def sky(conn, params) do
    case PointQueries.sky(params) do
      {:ok, payload} ->
        conn
        |> put_resp_header("cache-control", "private, max-age=60")
        |> json(payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def points_binary(conn, params) do
    if dynamic_points_disabled?() do
      conn
      |> put_status(:not_found)
      |> json(%{error: "dynamic_point_fallback_disabled"})
    else
      case PointQueries.points_binary(params) do
        {:ok, payload} ->
          conn
          |> put_resp_content_type("application/octet-stream")
          |> put_resp_header("cache-control", "public, max-age=600, stale-while-revalidate=3600")
          |> put_resp_header("x-starsmap-cache", Atom.to_string(payload.cache_status))
          |> put_resp_header("x-starsmap-total", Integer.to_string(payload.total))
          |> put_resp_header("x-starsmap-returned", Integer.to_string(payload.returned))
          |> send_resp(200, payload.binary)

        {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
          conn
          |> put_status(:bad_request)
          |> json(%{error: Atom.to_string(reason), parameter: key})
      end
    end
  end

  def nearest(conn, params) do
    case PointQueries.nearest(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def gaia(conn, %{"source_id" => source_id}) do
    case PublicObjects.gaia_object(source_id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, :invalid_source_id} ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_source_id"})

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})

      {:error, :upstream_unavailable} ->
        conn |> put_status(:bad_gateway) |> json(%{error: "gaia_tap_unavailable"})
    end
  end

  defp dynamic_points_disabled? do
    not dynamic_points_enabled?()
  end

  defp dynamic_points_enabled? do
    cond do
      truthy_env?("CATALOG_DYNAMIC_POINT_FALLBACK") ->
        true

      tile_manifest_configured?() ->
        false

      true ->
        Application.get_env(:starsmap_api, :dynamic_point_fallback_default_enabled, true)
    end
  end

  defp tile_manifest_configured? do
    "CATALOG_TILE_MANIFEST_URL"
    |> System.get_env("")
    |> String.trim()
    |> then(&(&1 != ""))
  end

  defp truthy_env?(key) do
    key
    |> System.get_env("")
    |> String.trim()
    |> String.downcase()
    |> then(&(&1 in ["1", "true", "yes", "on"]))
  end
end
