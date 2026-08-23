defmodule StarsmapApiWeb.ObjectController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.Catalog.PublicObjects

  def show(conn, %{"key" => key}) do
    case PublicObjects.get_by_key(key) do
      {:ok, object} ->
        json(conn, %{object: object})

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "object_not_found", key: key})

      {:error, :invalid_target_id} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_object_id", key: key})

      {:error, :upstream_unavailable} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "object_detail_upstream_unavailable", key: key})
    end
  end

  def external_links(conn, %{"key" => key}) do
    case PublicObjects.external_links_by_key(key) do
      {:ok, links} ->
        json(conn, %{key: key, external_links: links})

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "object_not_found", key: key})
    end
  end
end
