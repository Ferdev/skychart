defmodule StarsmapApi.CommunityFindingsTest do
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.{
    Action,
    Finding,
    Findings,
    Moderation,
    Photo,
    Photos,
    Privacy,
    SkySources,
    Subjects,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  @wcs %{
    "status" => "solved",
    "ra_deg" => 150.0,
    "dec_deg" => 2.0,
    "pixel_scale_arcsec" => 2.0,
    "rotation_deg" => 0.0,
    "width" => 800,
    "height" => 600
  }

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    author = Repo.insert!(%User{email: "a@example.com", handle: "author", name: "Author"})
    other = Repo.insert!(%User{email: "b@example.com", handle: "other", name: "Other"})

    moderator =
      Repo.insert!(%User{email: "m@example.com", handle: "mod", name: "Mod", role: "moderator"})

    {:ok, subject} = Subjects.ensure("moon")
    {:ok, author: author, other: other, moderator: moderator, subject: subject}
  end

  defp photo(author, subject, changes \\ []) do
    Repo.insert!(
      struct!(
        %Photo{
          user_id: author.id,
          subject_id: subject.id,
          declared_key: "moon",
          title: "Field",
          captured_at: ~U[2026-10-30 22:00:00.000000Z],
          licence: "CC BY 4.0",
          source_key: "uploads/#{Ecto.UUID.generate()}",
          size_bytes: 1,
          status: "published",
          wcs: @wcs,
          site_lat: 40.0,
          site_lon: -3.0,
          published_at: StarsmapApi.Community.now()
        },
        changes
      )
    )
  end

  defp candidate(ra \\ 150.02, dec \\ 2.02),
    do: %{
      "kind" => "candidate",
      "ra" => ra,
      "dec" => dec,
      "x" => 0.3,
      "y" => 0.4,
      "magnitude" => 17.2,
      "near_key" => "ngc-3000",
      "near_name" => "NGC 3000"
    }

  defp body,
    do: %{
      "kind" => "known_body",
      "designation" => "(433) Eros",
      "ra" => 150.0,
      "dec" => 2.0,
      "x" => 0.5,
      "y" => 0.5,
      "magnitude" => 12.0,
      "recovered" => true
    }

  test "only a solved photo with a time and a site can have a sweep", %{author: a, subject: s} do
    assert Findings.sweepable?(photo(a, s))
    refute Findings.sweepable?(photo(a, s, site_lat: nil))
    refute Findings.sweepable?(photo(a, s, wcs: %{@wcs | "status" => "author_supplied"}))
    refute Findings.sweepable?(photo(a, s, status: "hidden"))
  end

  test "the site is coarse and absent from the public payload" do
    assert Findings.coarse_site(%{"site_lat" => 40.416, "site_lon" => -3.703}) ==
             %{site_lat: 40.0, site_lon: -4.0}

    assert Findings.coarse_site(%{"site_lat" => 95, "site_lon" => 0}) == %{}
    assert Findings.coarse_site(%{}) == %{}
  end

  test "a public payload has no site", %{author: a, subject: s} do
    payload = Photos.public(photo(a, s))
    refute Map.has_key?(payload, :site_lat)
    refute Jason.encode!(payload) =~ "site_"
  end

  test "a finding is private until its author approves it", %{
    author: a,
    other: other,
    subject: s
  } do
    p = photo(a, s)
    assert {:ok, :ok} = Findings.store(p, [body()])
    assert Findings.public_for_photo(p.id) == []
    assert {:ok, []} = Findings.visible_to(other, p.id)
    assert {:ok, [finding]} = Findings.visible_to(a, p.id)
    assert {:error, :not_found} = Findings.set_public(other, finding.id, true)
    assert {:ok, %{state: "approved"}} = Findings.set_public(a, finding.id, true)
    assert [%{designation: "(433) Eros"}] = Findings.public_for_photo(p.id)
  end

  test "a candidate waits for a second frame from another time", %{
    author: a,
    moderator: m,
    subject: s
  } do
    first = photo(a, s)
    same_time = photo(a, s, captured_at: ~U[2026-10-30 22:20:00.000000Z])
    later = photo(a, s, captured_at: ~U[2026-11-02 22:00:00.000000Z])

    {:ok, :ok} = Findings.store(first, [candidate()])
    assert [%{state: "waiting_second"} = waiting] = Repo.all(Finding)
    assert Moderation.counts()["findings"] == 0
    assert {:error, :not_ready} = Findings.review(m, waiting.id, "approve", "")

    {:ok, :ok} = Findings.store(same_time, [candidate()])
    assert Moderation.counts()["findings"] == 0

    {:ok, :ok} = Findings.store(later, [candidate(150.0201, 2.0201)])
    assert Moderation.counts()["findings"] == 2
    assert Moderation.pending_count() >= 2
    assert [item | _] = Findings.review_list()
    assert item.second_frame.id
  end

  test "a place that does not match is no second frame", %{author: a, subject: s} do
    {:ok, :ok} = Findings.store(photo(a, s), [candidate()])

    {:ok, :ok} =
      Findings.store(photo(a, s, captured_at: ~U[2026-11-02 22:00:00.000000Z]), [
        candidate(150.05, 2.02)
      ])

    assert Moderation.counts()["findings"] == 0
  end

  test "a moderator and then the author open a candidate to the public", %{
    author: a,
    other: other,
    moderator: m,
    subject: s
  } do
    p = photo(a, s, equipment: "Newton 200")
    second = photo(a, s, captured_at: ~U[2026-11-02 22:00:00.000000Z])
    {:ok, :ok} = Findings.store(p, [candidate()])
    {:ok, :ok} = Findings.store(second, [candidate()])
    [finding] = Findings.review_list() |> Enum.filter(&(&1.photo_id == p.id))

    assert {:error, :not_allowed} = Findings.review(other, finding.id, "approve", "")
    assert {:error, :not_ready} = Findings.set_public(a, finding.id, true)
    assert {:ok, reviewed} = Findings.review(m, finding.id, "approve", "")
    assert reviewed.state == "reviewed"
    assert reviewed.report =~ "Unconfirmed"
    assert reviewed.report =~ "150.02000"
    refute reviewed.report =~ "discovery"
    assert Repo.get_by!(Action, finding_id: finding.id).action == "finding_approve"
    assert Findings.public_for_photo(p.id) == []

    assert {:ok, %{state: "approved"}} = Findings.set_public(a, finding.id, true)
    assert [%{kind: "candidate"}] = Findings.public_for_photo(p.id)
    assert [%{photo_id: id}] = Findings.for_object("ngc-3000")
    assert id == p.id
    assert [_] = Findings.for_author(a.id)
  end

  test "a rejected candidate never opens", %{author: a, moderator: m, subject: s} do
    p = photo(a, s)
    {:ok, :ok} = Findings.store(p, [candidate()])

    {:ok, :ok} =
      Findings.store(photo(a, s, captured_at: ~U[2026-11-02 22:00:00.000000Z]), [candidate()])

    [finding | _] = Findings.review_list()
    assert {:error, :invalid_request} = Findings.review(m, finding.id, "reject", "x")
    assert {:ok, %{state: "rejected"}} = Findings.review(m, finding.id, "reject", "Hot pixel")
    assert {:error, :not_ready} = Findings.set_public(a, finding.id, true)
  end

  test "a hidden photo leaves the public lists", %{author: a, subject: s} do
    p = photo(a, s)
    {:ok, :ok} = Findings.store(p, [Map.put(body(), "near_key", "ngc-1")])
    {:ok, [f]} = Findings.visible_to(a, p.id)
    {:ok, _} = Findings.set_public(a, f.id, true)
    Repo.update!(Ecto.Changeset.change(p, status: "hidden"))
    assert Findings.for_author(a.id) == []
    assert Findings.for_object("ngc-1") == []
  end

  test "a new sweep keeps a finding that the author approved", %{author: a, subject: s} do
    p = photo(a, s)
    {:ok, :ok} = Findings.store(p, [body()])
    {:ok, [f]} = Findings.visible_to(a, p.id)
    {:ok, _} = Findings.set_public(a, f.id, true)
    {:ok, :ok} = Findings.store(p, [body()])
    assert [%Finding{state: "approved"}] = Repo.all(Finding)
  end

  test "export holds the findings and erasure removes them and the site", %{
    author: a,
    subject: s
  } do
    p = photo(a, s)
    {:ok, :ok} = Findings.store(p, [body()])
    assert [_] = Privacy.export(a).findings
    assert {:ok, :ok} = Privacy.erase(a)
    assert Repo.aggregate(Finding, :count) == 0
    assert Repo.get!(Photo, p.id).site_lat == nil
  end

  test "the report names only the lists that the sweep compared the point with", %{
    author: a,
    moderator: m,
    subject: s
  } do
    p = photo(a, s)
    second = photo(a, s, captured_at: ~U[2026-11-02 22:00:00.000000Z])
    {:ok, :ok} = Findings.store(p, [candidate()])
    {:ok, :ok} = Findings.store(second, [candidate()])
    [finding] = Findings.review_list() |> Enum.filter(&(&1.photo_id == p.id))

    Repo.update!(Ecto.Changeset.change(p, assets: %{"sweep" => %{"searched" => ["dr11"]}}))
    assert {:ok, reviewed} = Findings.review(m, finding.id, "approve", "")
    assert reviewed.report =~ "Absent from: Legacy Surveys DR11\n"
    refute reviewed.report =~ "Gaia"
    refute reviewed.report =~ "ALeRCE"

    Repo.update!(Ecto.Changeset.change(Repo.get!(Photo, p.id), assets: %{}))
    refute Findings.report(Repo.get!(Finding, finding.id)) =~ "Absent from"
  end

  test "the rows of the JPL service become degrees" do
    payload = %{
      "data_first_pass" => [
        ["1234 Name", "01:30:00.00", "-05 30'36.0\"", "0", "0", "0", "15.2", "0", "0", "1", "1"],
        ["faint", "01:30:00.00", "+05 00'00.0\"", "0", "0", "0", "23.0", "0", "0", "1", "1"],
        ["no mag", "01:30:00.00", "+05 00'00.0\"", "0", "0", "0", "n.a.", "0", "0", "1", "1"],
        ["bad ra", "abc:10:20", "+05 00'00.0\"", "0", "0", "0", "15.0", "0", "0", "1", "1"],
        ["no ra", nil, "+05 00'00.0\"", "0", "0", "0", "15.0", "0", "0", "1", "1"]
      ]
    }

    assert [%{name: "1234 Name", ra: ra, dec: dec, magnitude: 15.2}] =
             SkySources.parse_small_bodies(payload, 21.0)

    assert_in_delta ra, 22.5, 1.0e-9
    assert_in_delta dec, -5.51, 1.0e-9
  end

  test "a right ascension or a declination that does not parse gives no position" do
    assert SkySources.sexagesimal("abc:10:20", "+05 10'30.5\"") == nil
    assert SkySources.sexagesimal("02:10", "+05 10'30.5\"") == nil
    assert SkySources.sexagesimal("02:10:30.50", "north") == nil
    assert SkySources.sexagesimal(nil, "+05:10:30.5") == nil
    assert {ra, dec} = SkySources.sexagesimal("02:10:30.50", "+05:10:30.5")
    assert_in_delta ra, 32.627083333, 1.0e-6
    assert_in_delta dec, 5.175138889, 1.0e-6
  end

  test "the rows of the survey service have numbers and a missing magnitude" do
    assert [%{ra: 150.1, dec: 2.2, mag: 21.0}, %{mag: nil}] =
             SkySources.parse_survey("ra,dec,mag_r\n150.1,2.2,21.0\n150.2,2.3,\n")
  end
end
