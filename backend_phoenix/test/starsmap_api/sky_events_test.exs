defmodule StarsmapApi.SkyEventsTest do
  use StarsmapApi.DataCase
  import Ecto.Query
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

  defp approach(source_id, starts_at, summary) do
    %{
      source: "jpl_cneos",
      source_id: source_id,
      kind: "close_approach",
      title: "2026 TR3 close approach",
      summary: summary,
      starts_at: starts_at,
      source_url: "https://example.test/2026-tr3"
    }
  end

  test "lists one row for each object and day when the predicted time changed" do
    now = ~U[2026-10-09 00:00:00Z]

    # Rows of an older release: the id had the full time, so each new prediction made a new row.
    {:ok, _} =
      Repo.insert(
        SkyEvent.changeset(
          %SkyEvent{},
          approach("2026 TR3:2026-10-09T14:02:00Z", ~U[2026-10-09 14:02:00Z], "old")
        )
      )

    {:ok, _} =
      Repo.insert(
        SkyEvent.changeset(
          %SkyEvent{},
          approach("2026 TR3:2026-10-09T14:05:00Z", ~U[2026-10-09 14:05:00Z], "new")
        )
      )

    Repo.update_all(from(e in SkyEvent, where: e.summary == "old"),
      set: [updated_at: ~U[2026-10-08 00:00:00.000000Z]]
    )

    # The same object on a different day is a different event.
    {:ok, _} =
      Repo.insert(
        SkyEvent.changeset(
          %SkyEvent{},
          approach("2026 TR3:2026-10-20", ~U[2026-10-20 03:00:00Z], "later")
        )
      )

    assert Enum.map(SkyEvents.list_upcoming(now), & &1.summary) == ["new", "later"]
  end

  test "a refresh removes the old row of a close approach whose time changed" do
    {:ok, _} =
      Repo.insert(
        SkyEvent.changeset(
          %SkyEvent{},
          approach("2026 TR3:2026-10-09T14:02:00Z", ~U[2026-10-09 14:02:00Z], "old")
        )
      )

    {:ok, _} =
      Repo.insert(
        SkyEvent.changeset(
          %SkyEvent{},
          approach("2026 TR3:2026-10-20", ~U[2026-10-20 03:00:00Z], "later")
        )
      )

    assert {:ok, 1} =
             SkyEvents.upsert_all([
               approach("2026 TR3:2026-10-09", ~U[2026-10-09 14:05:00Z], "new")
             ])

    assert Repo.all(from e in SkyEvent, order_by: e.starts_at, select: e.summary) == [
             "new",
             "later"
           ]

    # The same refresh again changes nothing.
    assert {:ok, 1} =
             SkyEvents.upsert_all([
               approach("2026 TR3:2026-10-09", ~U[2026-10-09 14:07:00Z], "newer")
             ])

    assert Repo.all(from e in SkyEvent, order_by: e.starts_at, select: e.summary) == [
             "newer",
             "later"
           ]
  end

  test "read routes degrade cleanly before the sky-events migration exists" do
    Repo.query!("SET LOCAL search_path TO pg_catalog")

    assert SkyEvents.list_upcoming() == []
    assert SkyEvents.last_refreshed_at() == nil
  end
end
