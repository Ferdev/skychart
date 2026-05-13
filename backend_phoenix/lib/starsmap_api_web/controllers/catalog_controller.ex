defmodule StarsmapApiWeb.CatalogController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Catalog

  def summary(conn, _params) do
    json(conn, Catalog.summary())
  end

  def search(conn, params) do
    json(conn, Catalog.search(params))
  end

  def viewport(conn, params) do
    case Catalog.list_viewport(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def density(conn, params) do
    case Catalog.density(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def points(conn, params) do
    case Catalog.points(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end

  def points_binary(conn, params) do
    case Catalog.points_binary(params) do
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

  def nearest(conn, params) do
    case Catalog.nearest(params) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {reason, key}} when reason in [:missing_param, :invalid_float] ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: Atom.to_string(reason), parameter: key})
    end
  end
end
