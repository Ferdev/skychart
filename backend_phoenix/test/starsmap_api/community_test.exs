defmodule StarsmapApi.CommunityTest do
  use ExUnit.Case, async: false
  import Ecto.Query

  alias StarsmapApi.Community.{
    Accounts,
    User,
    Photo,
    Photos,
    Subjects,
    Moderation,
    Ranking,
    Storage,
    Token
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  defmodule FailingMailer do
    def deliver(_email, _code), do: {:error, :mail_unavailable}
  end

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    Application.put_env(:starsmap_api, :community_test_mail_pid, self())
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_test_mail_pid) end)

    user =
      Repo.insert!(%User{
        email: "author@example.com",
        handle: "author",
        name: "Author",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    {:ok, subject} = Subjects.ensure("moon")
    {:ok, user: user, subject: subject}
  end

  test "email codes are one-time and wrong attempts persist" do
    assert :ok = Accounts.request_code("reader@example.com")
    assert_receive {:community_code, "reader@example.com", code}
    assert {:error, :invalid_code} = Accounts.verify("reader@example.com", "wrong")
    assert {:ok, token, user} = Accounts.verify("reader@example.com", code)
    assert Accounts.authenticate(token).id == user.id
    assert {:error, :invalid_code} = Accounts.verify("reader@example.com", code)
    Accounts.logout(token)
    refute Accounts.authenticate(token)
  end

  test "five attempts disable the code, and expiry is checked" do
    :ok = Accounts.request_code("attempts@example.com")
    assert_receive {:community_code, _, code}

    for _ <- 1..5,
        do: assert({:error, :invalid_code} = Accounts.verify("attempts@example.com", "bad"))

    assert {:error, :invalid_code} = Accounts.verify("attempts@example.com", code)
  end

  test "identity has source-backed Messier counterparts and preserves spaces" do
    assert "ngc-224" in Subjects.keys("m31")
    assert "local-volume-andromeda" in Subjects.keys("m31")
    assert Subjects.keys("ngc-foo bar") == ["ngc-foo bar"]
    assert {:error, :invalid_subject} = Subjects.ensure("catalog-tile-preview:any")
  end

  test "private photos do not enter galleries or the cover index", %{user: user, subject: subject} do
    photo = photo(user, subject, "review")
    assert Photos.gallery("moon") == []
    refute Photos.visible?(photo)
    StarsmapApi.Community.transaction(fn -> Ranking.refresh(subject.id) end)
    assert [%{"cover" => nil, "count" => 0}] = Ranking.index(0).items
  end

  test "approval and hiding emit an index removal and audit", %{user: user, subject: subject} do
    moderator =
      Repo.insert!(%User{
        email: "mod@example.com",
        handle: "moderator",
        name: "Moderator",
        role: "moderator"
      })

    photo = photo(user, subject, "review")
    assert {:error, :not_allowed} = Moderation.review(user, photo.id, "approve", "Looks correct")
    assert {:ok, published} = Moderation.review(moderator, photo.id, "approve", "Rights reviewed")
    assert Photos.visible?(published)
    index = Ranking.index(0)
    assert [%{"count" => 1}] = index.items
    assert {:ok, _} = Moderation.review(moderator, photo.id, "hide", "Reported attribution")
    assert Photos.gallery("moon") == []
    assert [%{"cover" => nil, "count" => 0}] = Ranking.index(index.version).items
    assert Repo.aggregate(StarsmapApi.Community.Action, :count) == 2
  end

  test "duplicate votes count once; self votes and young accounts fail", %{
    user: user,
    subject: subject
  } do
    photo = photo(user, subject, "published")
    assert {:error, :vote_not_allowed} = Ranking.vote(user, photo.id, true)

    voter =
      Repo.insert!(%User{
        email: "voter@example.com",
        handle: "voter",
        name: "Voter",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    assert {:ok, %{votes: 1}} = Ranking.vote(voter, photo.id, true)
    assert {:ok, %{votes: 1}} = Ranking.vote(voter, photo.id, true)
    assert {:ok, %{votes: 0}} = Ranking.vote(voter, photo.id, false)
    young = Repo.insert!(%User{email: "young@example.com", handle: "young", name: "Young"})
    assert {:error, :account_too_new} = Ranking.vote(young, photo.id, true)
  end

  test "real image processing creates stripped derivatives and requires initial review", %{
    user: user
  } do
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)
    source = Path.join(Storage.root(), "test-source-#{Ecto.UUID.generate()}.png")
    File.mkdir_p!(Path.dirname(source))
    {_, 0} = System.cmd("vips", ["black", source, "64", "32", "--bands", "3"])

    {:ok, photo} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => File.stat!(source).size,
        "title" => "Moon fixture",
        "licence" => "All rights reserved",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    :ok = Storage.Local.put(photo.source_key, source, false)
    assert {:ok, processing} = Photos.complete(user, photo.id)
    assert processing.status == "processing"
    assert :ok = StarsmapApi.Community.MediaWorker.process(processing)
    processed = Photos.get(photo.id)
    assert processed.status == "review"
    assert processed.sha256

    assert [%{"event" => "photo_review", "id" => id, "to" => "owner@example.com"}] =
             Repo.all(
               from j in Oban.Job,
                 where: j.worker == "StarsmapApi.Community.AdminNotifier",
                 select: j.args
             )

    assert id == photo.id
    assert processed.assets["perceptual_hash"] =~ ~r/^[0-9a-f]{16}$/
    assert processed.assets["dominant_color"] =~ ~r/^#[0-9a-f]{6}$/
    assert processed.assets["width"] == 64
    assert processed.assets["height"] == 32
    assert File.regular?(Storage.local_path("masters/#{photo.id}/320.webp"))
    refute Photos.visible?(processed)
    File.rm(source)
  end

  test "media and solver scripts resolve inside this checkout" do
    for script <- ["community_media.py", "community_solve.py"] do
      path = StarsmapApi.Community.backend_script(script)
      assert Path.dirname(path) == Path.expand("../../../backend", __DIR__)
      assert File.regular?(path)
    end
  end

  test "a photographer with approved photos still waits for a moderator", %{
    user: user,
    subject: subject
  } do
    for _ <- 1..3, do: photo(user, subject, "published")
    source = Path.join(Storage.root(), "auto-source-#{Ecto.UUID.generate()}.png")
    File.mkdir_p!(Path.dirname(source))
    {_, 0} = System.cmd("vips", ["black", source, "16", "16", "--bands", "3"])

    {:ok, p} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => File.stat!(source).size,
        "title" => "Fourth photo",
        "licence" => "CC BY 4.0",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    :ok = Storage.Local.put(p.source_key, source, false)
    {:ok, p} = Photos.complete(user, p.id)
    assert :ok = StarsmapApi.Community.MediaWorker.process(p)
    processed = Photos.get(p.id)
    assert processed.status == "review"
    assert is_nil(processed.published_at)
    refute Photos.visible?(processed)

    refute Repo.exists?(
             from j in Oban.Job, where: j.worker == "StarsmapApi.Community.PublishWorker"
           )

    assert p.id in Enum.map(Moderation.queue(), & &1.id)

    moderator =
      Repo.insert!(%User{
        email: "curator@example.com",
        handle: "curator",
        name: "Curator",
        role: "admin"
      })

    # Approval needs no typed reason. The audit record gets a default text.
    assert {:ok, published} = Moderation.review(moderator, p.id, "approve", "")
    assert Photos.visible?(published)
    assert [%{action: "approve", reason: "Approved"} | _] = Moderation.log()

    assert Repo.exists?(
             from j in Oban.Job, where: j.worker == "StarsmapApi.Community.PublishWorker"
           )

    File.rm(source)
  end

  test "moderators get counts, review signals and lists of each status", %{
    user: user,
    subject: subject
  } do
    moderator =
      Repo.insert!(%User{
        email: "lists@example.com",
        handle: "lists",
        name: "Lists",
        role: "moderator"
      })

    waiting = photo(user, subject, "review")
    twin = photo(user, subject, "review")
    published = photo(user, subject, "published")

    for p <- [waiting, twin],
        do: Repo.update!(Ecto.Changeset.change(p, sha256: "same", assets: %{"width" => 64}))

    assert {:ok, _} = Moderation.report(published.id, "Wrong credit")
    assert %{"review" => 2, "published" => 1, "hidden" => 0, "reports" => 1} = Moderation.counts()
    assert Moderation.pending_count() == 3

    detail = Moderation.detail(Photos.get(waiting.id))
    assert detail.status == "review"
    assert detail.width == 64
    assert detail.author.handle == "author"
    assert detail.author.published == 1
    assert [%{id: id, handle: "author"}] = detail.duplicates
    assert id == twin.id

    assert [%{reason: "Wrong credit", photo: %{reports: [%{reason: "Wrong credit"}]}}] =
             Moderation.reports()

    # A rejection without a reason fails, because the photographer reads the reason.
    assert {:error, :not_allowed} = Moderation.review(moderator, waiting.id, "reject", "")
    assert {:ok, _} = Moderation.review(moderator, waiting.id, "reject", "Wrong object")
    assert [%{id: rejected}] = Moderation.list("rejected")
    assert rejected == waiting.id
    assert Moderation.list("unknown") == []

    assert [%{moderation_reason: "Wrong object", status: "rejected"}] =
             Photos.mine(user) |> Enum.filter(&(&1.id == waiting.id))

    assert [%{action: "reject", moderator: "Lists", photo_title: "Test photo"} | _] =
             Moderation.log()
  end

  test "the address of an administrator gets the role only after verification" do
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)

    assert :ok = Accounts.request_code("owner@example.com")
    assert_receive {:community_code, "owner@example.com", code}
    assert Repo.get_by!(User, email: "owner@example.com").role == "member"
    assert {:ok, _, %User{role: "admin"}} = Accounts.verify("owner@example.com", code)

    assert :ok = Accounts.request_code("visitor@example.com")
    assert_receive {:community_code, "visitor@example.com", code}
    assert {:ok, _, %User{role: "member"}} = Accounts.verify("visitor@example.com", code)
  end

  test "the administrators get one notice for the first sign-in of a new user" do
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)
    notices = from j in Oban.Job, where: j.worker == "StarsmapApi.Community.AdminNotifier"

    assert :ok = Accounts.request_code("visitor@example.com")
    assert_receive {:community_code, "visitor@example.com", code}
    # An address that is not verified is not a new user.
    refute Repo.exists?(notices)
    assert {:ok, _, visitor} = Accounts.verify("visitor@example.com", code)
    assert visitor.first_sign_in_at

    assert [%Oban.Job{queue: "mail", args: args} = job] = Repo.all(notices)
    assert args == %{"event" => "new_user", "id" => visitor.id, "to" => "owner@example.com"}
    assert :ok = StarsmapApi.Community.AdminNotifier.perform(job)
    assert_receive {:community_notice, "owner@example.com", "Cosmic Atlas: new user", text}
    assert text =~ visitor.handle
    refute text =~ "visitor@example.com"

    # The next sign-in of the same account sends no notice.
    Repo.update_all(StarsmapApi.Community.Token, set: [inserted_at: ~U[2026-01-01 00:00:00Z]])
    assert :ok = Accounts.request_code("visitor@example.com")
    assert_receive {:community_code, "visitor@example.com", code}
    assert {:ok, _, _} = Accounts.verify("visitor@example.com", code)
    assert [_] = Repo.all(notices)

    # The sign-in of an administrator sends no notice.
    assert :ok = Accounts.request_code("owner@example.com")
    assert_receive {:community_code, "owner@example.com", code}
    assert {:ok, _, %User{role: "admin"}} = Accounts.verify("owner@example.com", code)
    assert [_] = Repo.all(notices)

    # An address that the operator removed from the list gets no mail.
    Application.put_env(:starsmap_api, :community_admin_emails, [])
    assert :ok = StarsmapApi.Community.AdminNotifier.perform(job)
    refute_receive {:community_notice, _, _, _}
  end

  test "no notice is queued when no administrator address is configured" do
    assert :ok = Accounts.request_code("visitor@example.com")
    assert_receive {:community_code, "visitor@example.com", code}
    assert {:ok, _, _} = Accounts.verify("visitor@example.com", code)

    refute Repo.exists?(
             from j in Oban.Job, where: j.worker == "StarsmapApi.Community.AdminNotifier"
           )
  end

  test "the administrators get a notice for each photo that waits for review", %{
    user: user,
    subject: subject
  } do
    Application.put_env(:starsmap_api, :community_admin_emails, [
      "owner@example.com",
      "second@example.com"
    ])

    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)
    photo = photo(user, subject, "review")

    assert {:ok, :ok} =
             StarsmapApi.Community.transaction(fn ->
               StarsmapApi.Community.AdminNotifier.enqueue("photo_review", photo.id)
             end)

    jobs =
      Repo.all(
        from j in Oban.Job,
          where: j.worker == "StarsmapApi.Community.AdminNotifier",
          order_by: j.id
      )

    assert ["owner@example.com", "second@example.com"] = Enum.map(jobs, & &1.args["to"])
    assert :ok = StarsmapApi.Community.AdminNotifier.perform(hd(jobs))

    assert_receive {:community_notice, "owner@example.com",
                    "Cosmic Atlas: photo waiting for review", text}

    assert text =~ photo.title
    assert text =~ "Photographer: author (Author)"
    assert text =~ "http://www.example.com"
    refute text =~ user.email
    refute_receive {:community_notice, "second@example.com", _, _}

    # A photo that a moderator already examined needs no notice.
    Repo.update!(Ecto.Changeset.change(photo, status: "published"))
    assert :ok = StarsmapApi.Community.AdminNotifier.perform(List.last(jobs))
    refute_receive {:community_notice, _, _, _}
  end

  test "newest listing, photographer statistics and coverage totals", %{
    user: user,
    subject: subject
  } do
    Application.put_env(
      :starsmap_api,
      :community_catalog_root,
      Path.expand("../../../data/catalogs", __DIR__)
    )

    on_exit(fn -> Application.delete_env(:starsmap_api, :community_catalog_root) end)

    old = photo(user, subject, "published")

    Repo.update!(
      Ecto.Changeset.change(old, published_at: DateTime.add(StarsmapApi.Community.now(), -3600))
    )

    new = photo(user, subject, "published")
    photo(user, subject, "review")
    assert Enum.map(Ranking.ranked("new"), & &1.id) == [new.id, old.id]
    assert Photos.public(new).object_name == subject.name

    assert %{rank: 1, photos: 2, objects: 1, votes: 0} = Ranking.photographer("author")
    assert is_nil(Ranking.photographer("nobody"))

    coverage = StarsmapApi.Community.Operations.coverage("messier", "andromeda")
    assert %{total: 110, covered: 0} = coverage.catalogs["messier"]
    assert coverage.total > 13_000
    assert [%{key: "m31", catalog: "messier", constellation: "And"}] = coverage.objects
    assert coverage.matched == 1
    all = StarsmapApi.Community.Operations.coverage()
    assert length(all.objects) == 200
    # The brightest objects are first.
    magnitudes = all.objects |> Enum.map(& &1.magnitude) |> Enum.reject(&is_nil/1)
    assert magnitudes == Enum.sort(magnitudes)
  end

  test "rank snapshots preserve first-photo credit and author removals cannot be restored", %{
    user: user,
    subject: subject
  } do
    p = photo(user, subject, "published")
    StarsmapApi.Community.transaction(fn -> Ranking.refresh(subject.id) end)
    assert hd(Ranking.photographers()).first_photos == 1
    assert hd(Ranking.photographers()).covers == 1
    assert :ok = StarsmapApi.Community.RankingWorker.perform(%Oban.Job{})
    assert Repo.aggregate("ranking_snapshots", :count) == 3
    assert {:ok, :ok} = Moderation.remove(user, p.id)

    mod =
      Repo.insert!(%User{
        email: "mod-removed@example.com",
        handle: "mod-removed",
        name: "Moderator",
        role: "moderator"
      })

    assert {:error, :not_allowed} =
             Moderation.review(mod, p.id, "restore", "Cannot restore author removals")

    assert Ranking.photographers() == []
  end

  test "a failed delivery counts against neither request limit" do
    mailer = Application.fetch_env!(:starsmap_api, :community_mailer)
    Application.put_env(:starsmap_api, :community_mailer, FailingMailer)
    on_exit(fn -> Application.put_env(:starsmap_api, :community_mailer, mailer) end)

    # More retries than the daily limit, all of them inside the 60-second wait.
    for _ <- 1..11 do
      assert {:error, :mail_unavailable} = Accounts.request_code("retry@example.com")
    end

    assert Repo.aggregate(from(t in Token, where: t.context == "code"), :count) == 0

    Application.put_env(:starsmap_api, :community_mailer, mailer)
    assert :ok = Accounts.request_code("retry@example.com")
    assert_receive {:community_code, "retry@example.com", code}
    assert {:ok, _token, _user} = Accounts.verify("retry@example.com", code)
  end

  test "a sent code still holds the next request" do
    assert :ok = Accounts.request_code("reader@example.com")
    assert_receive {:community_code, "reader@example.com", _code}
    assert {:error, :rate_limited} = Accounts.request_code("reader@example.com")
    refute_received {:community_code, _, _}
  end

  test "disposable mail domains are blocked before an account is created" do
    assert {:error, :invalid_email} = Accounts.request_code("reader@mailinator.com")
    refute Repo.get_by(User, email: "reader@mailinator.com")
  end

  test "S3 upload signatures bind the reserved size and prevent replacement", %{
    user: user,
    subject: subject
  } do
    original = Application.get_all_env(:ex_aws)
    original_bucket = Application.get_env(:starsmap_api, :community_s3_bucket)

    on_exit(fn ->
      for {key, _} <- Application.get_all_env(:ex_aws), do: Application.delete_env(:ex_aws, key)
      for {key, value} <- original, do: Application.put_env(:ex_aws, key, value)
      Application.put_env(:starsmap_api, :community_s3_bucket, original_bucket)
    end)

    Application.put_env(:ex_aws, :access_key_id, "local-test-key")
    Application.put_env(:ex_aws, :secret_access_key, "local-test-secret")
    Application.put_env(:ex_aws, :region, "us-east-1")
    Application.put_env(:starsmap_api, :community_s3_bucket, "local-test-bucket")
    p = photo(user, subject, "uploading")
    assert {:ok, intent} = Storage.S3.intent(p)
    assert intent.headers == %{"if-none-match" => "*"}
    query = URI.decode_query(URI.parse(intent.url).query)
    assert query["X-Amz-SignedHeaders"] == "content-length;host;if-none-match"
    assert query["X-Amz-Expires"] == "900"
  end

  test "upload metadata rejects oversized files and absent rights", %{user: user} do
    assert {:error, _} =
             Photos.create(user, %{
               "key" => "moon",
               "size_bytes" => 60_000_001,
               "rights_confirmed" => true
             })

    assert {:error, _} =
             Photos.create(user, %{
               "key" => "moon",
               "size_bytes" => 1,
               "rights_confirmed" => false
             })
  end

  test "vote weights, trend threshold and cover changes are deterministic", %{
    user: user,
    subject: subject
  } do
    first = photo(user, subject, "published")
    second = photo(user, subject, "published")

    voter =
      Repo.insert!(%User{
        email: "weighted@example.com",
        handle: "weighted",
        name: "Weighted",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    assert {:ok, _} = Ranking.vote(voter, first.id, true)
    assert {:ok, _} = Ranking.vote(voter, second.id, true)
    assert_in_delta Ranking.scores()[first.id].score, 1.0, 0.0001
    assert_in_delta Ranking.scores()[second.id].score, 0.5, 0.0001
    assert Ranking.scores()[second.id].trend == 0
    assert {:ok, _} = Ranking.vote(voter, first.id, false)
    assert_in_delta Ranking.scores()[second.id].score, 1.0, 0.0001
    assert [%{"cover" => %{"id" => id}}] = Ranking.index(0).items
    assert id == second.id
    assert hd(Photos.gallery("moon")).id == second.id
  end

  test "reports are resolved by audited moderation and suspension removes public covers", %{
    user: user,
    subject: subject
  } do
    moderator =
      Repo.insert!(%User{
        email: "reviewer@example.com",
        handle: "reviewer",
        name: "Reviewer",
        role: "moderator"
      })

    photo = photo(user, subject, "published")
    assert {:ok, _} = Moderation.report(photo.id, "Attribution needs review")
    assert length(Moderation.reports()) == 1
    assert {:error, :not_allowed} = Moderation.suspend(user, user.handle, "Abuse review", true)
    assert {:ok, _} = Moderation.review(moderator, photo.id, "hide", "Attribution review")
    assert Moderation.reports() == []
    assert {:ok, _} = Moderation.review(moderator, photo.id, "restore", "Permission confirmed")
    assert {:ok, _} = Moderation.suspend(moderator, user.handle, "Repeated abuse", true)
    assert Photos.gallery("moon") == []
    assert [%{"cover" => nil}] = Ranking.index(0).items
  end

  test "account deletion revokes login, hides photos and queues byte removal", %{
    user: user,
    subject: subject
  } do
    p = photo(user, subject, "published")
    assert {:ok, :ok} = StarsmapApi.Community.Privacy.erase(user)
    assert Repo.get!(User, user.id).suspended
    refute Photos.visible?(Photos.get(p.id))
    assert Photos.gallery("moon") == []
    assert Repo.get!(User, user.id).email != user.email

    assert Repo.exists?(
             Ecto.Query.from(j in Oban.Job,
               where: j.worker == "StarsmapApi.Community.PurgeWorker"
             )
           )
  end

  test "TAN image annotations preserve reference pixels and parity" do
    w = %{
      "ra_deg" => 0,
      "dec_deg" => 0,
      "width" => 100,
      "height" => 80,
      "pixel_scale_arcsec" => 3.6,
      "rotation_deg" => 0
    }

    {x, y} = StarsmapApi.Community.Annotations.pixel(w, 0, 0)
    assert_in_delta x, 0.5, 0.000001
    assert_in_delta y, 0.5, 0.000001

    {x, y} =
      StarsmapApi.Community.Annotations.pixel(
        Map.merge(w, %{"cd" => [-0.001, 0, 0, 0.001], "crpix" => [25.5, 20.5]}),
        0,
        0
      )

    assert_in_delta x, 0.25, 0.000001
    assert_in_delta y, 0.75, 0.000001
    assert is_nil(StarsmapApi.Community.Annotations.pixel(w, 180, 0))

    assert {:error, :invalid_wcs} =
             StarsmapApi.Community.Astrometry.validate(Map.put(w, "width", 200_000_000))
  end

  defp photo(user, subject, status) do
    Repo.insert!(%Photo{
      user_id: user.id,
      subject_id: subject.id,
      declared_key: "moon",
      title: "Test photo",
      caption: "",
      licence: "All rights reserved",
      captured_at: StarsmapApi.Community.now(),
      status: status,
      source_key: "uploads/#{Ecto.UUID.generate()}",
      size_bytes: 100,
      published_at: if(status == "published", do: StarsmapApi.Community.now(), else: nil)
    })
  end
end
