defmodule StarsmapApi.CommunitySkyQueriesTest do
  @moduledoc """
  Sky queries with a row limit: the limit counts only rows near the requested place, so that a
  bright or new row elsewhere in the declination band does not push a row in the field out.
  """
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.{
    Annotations,
    FieldCatalog,
    Finding,
    Findings,
    Photo,
    SkyOverlay,
    Subjects,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(StarsmapApi.Repo, {:shared, self()})
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    user = Repo.insert!(%User{email: "a@example.com", handle: "author", name: "Author"})
    {:ok, subject} = Subjects.ensure("moon")
    {:ok, user: user, subject: subject}
  end

  defp catalog(rows) do
    now = NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)

    rows
    |> Enum.map(fn {key, ra, dec, magnitude} ->
      %{
        id: Ecto.UUID.dump!(Ecto.UUID.generate()),
        key: key,
        name: key,
        catalog_object_key: key,
        position_model: "fixed",
        source_type: "deep_sky",
        catalog_group: "ngc_ic_deep_sky",
        object_type: "galaxy",
        ra_deg: ra,
        dec_deg: dec,
        apparent_magnitude: magnitude,
        inserted_at: now,
        updated_at: now
      }
    end)
    |> Enum.chunk_every(500)
    |> Enum.each(&StarsmapApi.Repo.insert_all("catalog_deep_sky_objects", &1))
  end

  defp keys(rows), do: rows |> Enum.map(& &1.key) |> Enum.sort()

  defp ngc(ra, dec, radius, options),
    do: FieldCatalog.cone(ra, dec, radius, [groups: ["ngc_ic_deep_sky"]] ++ options)

  test "rows in the corners of the box do not take the places of rows in the circle" do
    # The corners are in the declination and right-ascension box, but out of the circle.
    corners = for i <- 1..30, do: {"corner-#{i}", 10.9 + i * 1.0e-4, 10.9, 1.0}
    catalog([{"inside", 10.2, 10.1, 15.0} | corners])

    assert keys(ngc(10.0, 10.0, 1.0, limit: 10)) == ["inside"]
  end

  test "a circle with a pole and a circle across right ascension 0 keep all of their rows" do
    catalog([
      {"pole-far-side", 190.0, 89.8, 5.0},
      {"pole-out", 190.0, 87.0, 5.0},
      {"wrap-east", 0.1, 0.0, 5.0},
      {"wrap-west", 359.9, 0.0, 5.0},
      {"wrap-out", 1.0, 0.0, 5.0}
    ])

    assert keys(ngc(20.0, 89.5, 1.0, [])) == ["pole-far-side"]
    assert keys(ngc(359.8, 0.0, 0.5, [])) == ["wrap-east", "wrap-west"]
    assert keys(ngc(-0.2, 0.0, 0.5, [])) == ["wrap-east", "wrap-west"]
  end

  test "an integer magnitude limit filters the rows" do
    catalog([{"bright", 50.0, 0.0, 11.0}, {"faint", 50.1, 0.0, 13.0}])

    assert keys(ngc(50.0, 0.0, 1.0, max_magnitude: 12)) == ["bright"]
    assert keys(ngc(50.0, 0.0, 1.0, max_magnitude: 12.5)) == ["bright"]
  end

  test "a wide photo gets the label of a faint object in its frame", %{
    user: user,
    subject: subject
  } do
    elsewhere = for i <- 1..1001, do: {"bright-#{i}", 180.0 + i * 0.05, 30.0, 1.0}
    catalog([{"faint-in-frame", 40.0, 30.0, 14.0} | elsewhere])

    photo =
      photo(user, subject,
        wcs: %{
          "frame" => "ICRS",
          "epoch" => "J2000",
          "ra_deg" => 40.0,
          "dec_deg" => 30.0,
          "pixel_scale_arcsec" => 20.0,
          "rotation_deg" => 0.0,
          "width" => 1000,
          "height" => 800
        }
      )

    assert :ok = Annotations.rebuild(photo)
    assert Enum.map(Annotations.list(photo.id), & &1.key) == ["faint-in-frame"]
  end

  defp photo(user, subject, changes) do
    Repo.insert!(
      struct!(
        %Photo{
          user_id: user.id,
          subject_id: subject.id,
          declared_key: "moon",
          title: "Field",
          captured_at: ~U[2026-10-30 22:00:00.000000Z],
          licence: "CC BY 4.0",
          source_key: "uploads/#{Ecto.UUID.generate()}",
          size_bytes: 1,
          status: "published",
          wcs: %{"status" => "solved", "ra_deg" => 150.0, "dec_deg" => 2.0},
          site_lat: 40.0,
          site_lon: -3.0,
          published_at: StarsmapApi.Community.now()
        },
        changes
      )
    )
  end

  test "a second frame matches across many candidates in the same declination band", %{
    user: user,
    subject: subject
  } do
    crowd = photo(user, subject, captured_at: ~U[2026-10-01 22:00:00.000000Z])
    now = StarsmapApi.Community.now()

    Repo.insert_all(
      Finding,
      for i <- 1..201 do
        %{
          id: Ecto.UUID.generate(),
          photo_id: crowd.id,
          kind: "candidate",
          ra_deg: 10.0 + i * 0.1,
          dec_deg: 2.02,
          x: 0.5,
          y: 0.5,
          state: "waiting_second",
          inserted_at: DateTime.add(now, -86_400),
          updated_at: DateTime.add(now, -86_400)
        }
      end
    )

    candidate = %{"kind" => "candidate", "ra" => 150.02, "dec" => 2.02, "x" => 0.3, "y" => 0.4}
    first = photo(user, subject, [])
    later = photo(user, subject, captured_at: ~U[2026-11-02 22:00:00.000000Z])
    {:ok, :ok} = Findings.store(first, [candidate])
    {:ok, :ok} = Findings.store(later, [%{candidate | "ra" => 150.0201}])

    import Ecto.Query

    states =
      Repo.all(from f in Finding, where: f.photo_id in ^[first.id, later.id], select: f.state)

    assert Enum.sort(states) == ["review", "review"]
  end

  test "an older photo stays on the sky when many newer photos share its declination band", %{
    user: user,
    subject: subject
  } do
    wcs = fn ra ->
      %{
        "status" => "solved",
        "projection" => "TAN",
        "frame" => "ICRS",
        "epoch" => "J2000",
        "ra_deg" => ra,
        "dec_deg" => 10.0,
        "pixel_scale_arcsec" => 2.0,
        "rotation_deg" => 0.0,
        "width" => 600,
        "height" => 400,
        "cd" => [-0.000556, 0.0, 0.0, 0.000556],
        "crpix" => [300.5, 200.5]
      }
    end

    older = photo(user, subject, wcs: wcs.(180.0), published_at: ~U[2026-01-01 00:00:00.000000Z])
    now = StarsmapApi.Community.now()

    rows =
      for i <- 1..2001 do
        %{
          id: Ecto.UUID.generate(),
          user_id: user.id,
          subject_id: subject.id,
          declared_key: "moon",
          title: "Newer",
          licence: "CC BY 4.0",
          source_key: "uploads/#{i}",
          size_bytes: 1,
          status: "published",
          wcs: wcs.(0.0),
          captured_at: now,
          published_at: now,
          inserted_at: now,
          updated_at: now
        }
      end

    rows |> Enum.chunk_every(500) |> Enum.each(&Repo.insert_all(Photo, &1))

    assert older.id in Enum.map(SkyOverlay.list(180.0, 10.0, 1.0), & &1.id)
    assert length(SkyOverlay.list(359.9, 10.0, 1.0)) == SkyOverlay.limit()
  end
end
