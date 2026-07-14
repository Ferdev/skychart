defmodule StarsmapApiWeb.EventControllerTest do
  use StarsmapApiWeb.ConnCase, async: true

  test "accepts allowlisted events without cookies", %{conn: conn} do
    conn = post(conn, ~p"/api/events", %{name: "page_view", path: "/", properties: %{}})
    assert response(conn, 204) == "" and get_resp_header(conn, "set-cookie") == []
  end

  test "returns a generic validation error", %{conn: conn} do
    assert %{"error" => "invalid event"} =
             conn |> post(~p"/api/events", %{name: "password", path: "/"}) |> json_response(422)
  end

  test "accepts the embed-loaded event with a hostname-only referrer", %{conn: conn} do
    conn =
      post(conn, ~p"/api/events", %{
        name: "embed_loaded",
        path: "/embed",
        referrer: "classroom.example",
        properties: %{}
      })

    assert response(conn, 204) == ""
  end
end
