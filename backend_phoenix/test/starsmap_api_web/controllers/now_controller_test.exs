defmodule StarsmapApiWeb.NowControllerTest do
  use StarsmapApiWeb.ConnCase, async: true
  alias StarsmapApi.{Repo, SkyEvents.SkyEvent}

  setup do
    {:ok, event} =
      Repo.insert(
        SkyEvent.changeset(%SkyEvent{}, %{
          source: "jpl_cneos",
          source_id: "test<&",
          kind: "close_approach",
          title: "Test <approach>",
          summary: "Safe & close",
          starts_at: DateTime.add(DateTime.utc_now(), 3600),
          source_url: "https://example.test/?a=1&b=2"
        })
      )

    %{event: event}
  end

  test "serves events and freshness", %{conn: conn} do
    p = conn |> get(~p"/api/now") |> json_response(200)
    assert is_boolean(p["stale"])
    assert [%{"title" => "Test <approach>"} | _] = p["events"]
  end

  test "the calendar has cache headers and answers 304 to a current copy", %{conn: conn} do
    response = get(conn, ~p"/calendar.ics")
    assert response(response, 200) =~ "BEGIN:VEVENT"
    assert hd(get_resp_header(response, "content-type")) =~ "text/calendar"
    assert hd(get_resp_header(response, "cache-control")) =~ "max-age=3600"
    [etag] = get_resp_header(response, "etag")

    again = build_conn() |> put_req_header("if-none-match", etag) |> get(~p"/calendar.ics")
    assert response(again, 304) == ""
  end

  test "a calendar client with its own Accept header gets the calendar", %{conn: conn} do
    response = conn |> put_req_header("accept", "text/calendar") |> get(~p"/calendar.ics")
    assert response.status == 200
  end

  test "the calendar filters by type and refuses an unknown type", %{conn: conn} do
    assert conn
           |> get(~p"/calendar.ics?types=new_exoplanet")
           |> response(200)
           |> String.contains?("VEVENT") == false

    payload = conn |> get(~p"/calendar.ics?types=meteor") |> json_response(400)
    assert payload["error"] == "invalid_types"
    assert "close_approach" in payload["accepted"]
  end

  test "Atom escapes upstream strings", %{conn: conn} do
    body = conn |> get(~p"/feed.xml") |> response(200)
    assert body =~ "Test &lt;approach&gt;"
    assert body =~ "Safe &amp; close"
    refute body =~ "<title>Test <approach>"
  end
end
