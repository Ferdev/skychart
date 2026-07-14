defmodule StarsmapApi.SkyEventsTest do
  use StarsmapApi.DataCase
  alias StarsmapApi.{Repo, SkyEvents, SkyEvents.SkyEvent}

  test "keeps recent discoveries while dropping old close approaches" do
    now = ~U[2026-07-14 12:00:00Z]

    for {source, source_id, kind} <- [
          {"nasa_exoplanet_archive", "recent-discovery", "new_exoplanet"},
          {"jpl_cneos", "old-approach", "close_approach"}
        ] do
      {:ok, _} =
        Repo.insert(
          SkyEvent.changeset(%SkyEvent{}, %{
            source: source,
            source_id: source_id,
            kind: kind,
            title: source_id,
            summary: "test event",
            starts_at: DateTime.add(now, -10 * 86_400, :second),
            source_url: "https://example.test/#{source_id}"
          })
        )
    end

    assert Enum.map(SkyEvents.list_upcoming(now), & &1.source_id) == ["recent-discovery"]
  end

  test "read routes degrade cleanly before the sky-events migration exists" do
    Repo.query!("SET LOCAL search_path TO pg_catalog")

    assert SkyEvents.list_upcoming() == []
    assert SkyEvents.last_refreshed_at() == nil
  end
end
