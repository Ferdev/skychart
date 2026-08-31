defmodule StarsmapApiWeb.AgentApiController do
  use StarsmapApiWeb, :controller

  alias StarsmapApi.AgentInterface

  def search(conn, params), do: respond(conn, AgentInterface.search(params))
  def object(conn, %{"key" => key}), do: respond(conn, AgentInterface.object(key))

  def catalogs(conn, _params) do
    conn
    |> put_resp_header("cache-control", "public, max-age=3600")
    |> json(AgentInterface.catalogs())
  end

  def view_link(conn, params), do: respond(conn, AgentInterface.view_link(params))

  defp respond(conn, {:ok, payload}), do: json(conn, payload)

  defp respond(conn, {:error, %{code: code} = error}) do
    status = if code == "object_not_found", do: :not_found, else: :bad_request

    conn
    |> put_status(status)
    |> json(%{error: error})
  end
end
