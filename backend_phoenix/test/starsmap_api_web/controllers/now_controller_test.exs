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

  test "Atom escapes upstream strings", %{conn: conn} do
    body = conn |> get(~p"/feed.xml") |> response(200)
    assert body =~ "Test &lt;approach&gt;"
    assert body =~ "Safe &amp; close"
    refute body =~ "<title>Test <approach>"
  end
end
