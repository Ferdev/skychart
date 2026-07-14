defmodule StarsmapApiWeb.EventController do
  use StarsmapApiWeb, :controller
  alias StarsmapApi.Analytics
  alias StarsmapApiWeb.ClientIp

  def create(conn, params) do
    if body_too_large?(conn),
      do: conn |> put_status(:payload_too_large) |> json(%{error: "invalid event"}),
      else: respond(conn, Analytics.record(params, ClientIp.resolve(conn)))
  end

  defp respond(conn, {:ok, _}), do: send_resp(conn, :no_content, "")

  defp respond(conn, {:error, _}),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: "invalid event"})

  defp body_too_large?(conn) do
    case get_req_header(conn, "content-length") do
      [value] ->
        case Integer.parse(value) do
          {size, ""} -> size > 2_048
          _ -> true
        end

      _ ->
        false
    end
  end
end
