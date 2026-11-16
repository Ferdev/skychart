defmodule StarsmapApiWeb.TargetSnapshotController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.Catalog.TargetSnapshot

  def create(conn, params) do
    if byte_size(Jason.encode!(params)) > 1_500_000 do
      conn |> put_status(413) |> json(%{error: "too_large"})
    else
      case TargetSnapshot.create(params) do
        {:ok, result} ->
          conn
          |> put_status(201)
          |> json(%{url: "/targets/r/" <> result.token, snapshot: result.payload})

        {:error, :quota_full} ->
          conn |> put_status(507) |> json(%{error: "share_storage_full"})

        {:error, reason} ->
          conn |> put_status(422) |> json(%{error: to_string(reason)})
      end
    end
  rescue
    _ -> conn |> put_status(503) |> json(%{error: "sharing_unavailable"})
  end

  def show(conn, %{"token" => token}) do
    conn =
      conn
      |> put_resp_header("cache-control", "no-store")
      |> put_resp_header("referrer-policy", "no-referrer")
      |> put_resp_header("x-robots-tag", "noindex, nofollow")

    case TargetSnapshot.read(token, get_req_header(conn, "x-atlas-measurement") != ["owner-test"]) do
      {:ok, payload} -> json(conn, payload)
      _ -> conn |> put_status(404) |> json(%{error: "snapshot_not_found"})
    end
  rescue
    _ -> conn |> put_status(503) |> json(%{error: "sharing_unavailable"})
  end
end
