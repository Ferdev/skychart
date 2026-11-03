defmodule StarsmapApi.CommunityTest do
  use ExUnit.Case, async: false
  import Ecto.Query

  alias StarsmapApi.Community.{
    Accounts,
    Action,
    User,
    Photo,
    Photos,
    Subjects,
    Moderation,
    Ranking,
    Storage,
    Token,
    Vote
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

  test "an error report drops the request of a private calculation or list" do
    alias StarsmapApi.Community.Privacy

    for url <- [
          "https://skychart.org/api/observe?key=mars&lat=1.5&lon=2.5",
          "https://skychart.org/api/observe/plan",
          "https://skychart.org/api/catalog/match"
        ] do
      event = %{
        request: %{url: url, data: %{"latitude_deg" => 1.0}},
        extra: %{a: 1},
        user: %{},
        breadcrumbs: []
      }

      assert Privacy.scrub(event).request == %{}
    end

    public = %{request: %{url: "https://skychart.org/api/catalog/search"}}
    assert Privacy.scrub(public) == public
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
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800),
        first_sign_in_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    assert {:ok, %{votes: 1}} = Ranking.vote(voter, photo.id, true)
    assert {:ok, %{votes: 1}} = Ranking.vote(voter, photo.id, true)
    assert {:ok, %{votes: 0}} = Ranking.vote(voter, photo.id, false)
    young = Repo.insert!(%User{email: "young@example.com", handle: "young", name: "Young"})
    assert {:error, :account_too_new} = Ranking.vote(young, photo.id, true)
  end

  test "the age of an account for votes starts at its first verified sign-in", %{
    user: user,
    subject: subject
  } do
    photo = photo(user, subject, "published")
    two_days_ago = DateTime.add(StarsmapApi.Community.now(), -172_800)

    # An old row is a new account when the address is verified only now.
    assert :ok = Accounts.request_code("aged@example.com")
    assert_receive {:community_code, "aged@example.com", code}

    Repo.get_by!(User, email: "aged@example.com")
    |> Ecto.Changeset.change(inserted_at: two_days_ago)
    |> Repo.update!()

    assert {:ok, _, aged} = Accounts.verify("aged@example.com", code)
    assert aged.first_sign_in_at
    assert {:error, :account_too_new} = Ranking.vote(aged, photo.id, true)

    never_signed_in =
      Repo.insert!(%User{
        email: "unverified@example.com",
        handle: "unverified",
        name: "Unverified",
        inserted_at: two_days_ago
      })

    assert {:error, :account_too_new} = Ranking.vote(never_signed_in, photo.id, true)

    # The same account can vote 24 hours after its first sign-in.
    aged = Repo.update!(Ecto.Changeset.change(aged, first_sign_in_at: two_days_ago))
    assert {:ok, %{votes: 1}} = Ranking.vote(aged, photo.id, true)
  end

  test "a vote has no weight until 24 hours after the first sign-in of the voter", %{
    user: user,
    subject: subject
  } do
    photo = photo(user, subject, "published")

    voter =
      Repo.insert!(%User{
        email: "recent@example.com",
        handle: "recent",
        name: "Recent",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800),
        first_sign_in_at: StarsmapApi.Community.now()
      })

    Repo.insert!(%StarsmapApi.Community.Vote{user_id: voter.id, photo_id: photo.id})
    refute Map.has_key?(Ranking.scores(), photo.id)

    Repo.update!(
      Ecto.Changeset.change(voter,
        first_sign_in_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      )
    )

    assert_in_delta Ranking.scores()[photo.id].score, 1.0, 0.0001
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

  describe "with a decoder that hangs" do
    setup %{user: user} do
      root = Application.fetch_env!(:starsmap_api, :community_backend_root)
      fixture = Path.join(System.tmp_dir!(), "hung-decoder-#{Ecto.UUID.generate()}")
      pids = Path.join(fixture, "pids")
      File.mkdir_p!(fixture)

      File.write!(Path.join(fixture, "community_media.py"), """
      import os, subprocess, sys, time
      source, output = sys.argv[1:]
      if open(source, 'rb').read(4) == b'HANG':
          child = subprocess.Popen(['sleep', '60'])
          with open(#{inspect(pids)}, 'w') as file:
              file.write(f'{os.getpid()} {child.pid}')
          time.sleep(60)
      os.makedirs(output)
      for name in ('master.png', '96.webp', '320.webp', '1600.webp'):
          open(os.path.join(output, name), 'w').close()
      print('{"sha256": "next"}')
      """)

      Application.put_env(:starsmap_api, :community_backend_root, fixture)
      Application.put_env(:starsmap_api, :community_decode_limit_seconds, 2)

      on_exit(fn ->
        Application.put_env(:starsmap_api, :community_backend_root, root)
        Application.delete_env(:starsmap_api, :community_decode_limit_seconds)
        File.rm_rf(fixture)
      end)

      {:ok, hung: processing_photo(user, "HANG"), pids: pids}
    end

    test "the job ends at the limit, the decoder stops and the next photo starts", %{
      user: user,
      hung: hung,
      pids: pids
    } do
      next = processing_photo(user, "NEXT")
      started = System.monotonic_time(:second)

      assert %{failure: 1, success: 1} =
               Oban.drain_queue(StarsmapApi.CommunityJobs, queue: :media)

      assert System.monotonic_time(:second) - started < 10

      assert Photos.get(hung.id).status == "processing"
      assert Photos.get(next.id).status == "review"

      assert [%Oban.Job{errors: [%{"error" => error}]}] =
               Repo.all(
                 from j in Oban.Job,
                   where:
                     j.worker == "StarsmapApi.Community.MediaWorker" and j.state == "retryable"
               )

      assert error =~ "{:decoder_exit, :timeout}"
      assert Path.wildcard(Path.join(Storage.root(), "scratch/#{hung.id}-*")) == []

      for pid <- pids |> File.read!() |> String.split(), do: assert(stopped?(pid))
    end

    test "a timeout on the last attempt fails the photo", %{hung: hung} do
      assert {:error, {:decoder_exit, :timeout}} = media_attempt(hung, 3)
      assert Photos.get(hung.id).status == "failed"
    end
  end

  test "the Oban timeout of the media job comes after the decoder limit" do
    assert StarsmapApi.Community.MediaWorker.timeout(%Oban.Job{}) > :timer.seconds(125)
  end

  test "a corrupt upload fails the photo and cancels the job", %{user: user} do
    photo = processing_photo(user, <<0x89, "PNG\r\n", 0x1A, "\nnot a real image">>)

    assert {:cancel, "Image rejected by the decoder"} = media_attempt(photo, 1)
    assert Photos.get(photo.id).status == "failed"
  end

  test "a killed decoder keeps the photo for a retry and fails it after the last attempt", %{
    user: user
  } do
    photo = processing_photo(user, "any bytes")
    use_killed_decoder()

    assert {:error, {:decoder_exit, status}} = media_attempt(photo, 1)
    assert status not in [0, 65]
    assert Photos.get(photo.id).status == "processing"

    assert {:error, {:decoder_exit, ^status}} = media_attempt(photo, 2)
    assert Photos.get(photo.id).status == "processing"

    assert {:error, {:decoder_exit, ^status}} = media_attempt(photo, 3)
    assert Photos.get(photo.id).status == "failed"
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
    assert {:error, :invalid_reason} = Moderation.review(moderator, waiting.id, "reject", "")
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

  test "an administrator whose address left the list is a member at the next request" do
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)

    assert :ok = Accounts.request_code("owner@example.com")
    assert_receive {:community_code, "owner@example.com", code}
    assert {:ok, token, %User{role: "admin"}} = Accounts.verify("owner@example.com", code)
    assert %User{role: "admin"} = Accounts.authenticate(token)

    Application.put_env(:starsmap_api, :community_admin_emails, ["other@example.com"])
    assert %User{role: "member"} = Accounts.authenticate(token)
    assert Repo.get_by!(User, email: "owner@example.com").role == "member"

    # An open session does not get the role again. The next sign-in gives it.
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    assert %User{role: "member"} = Accounts.authenticate(token)
    Repo.update_all(StarsmapApi.Community.Token, set: [inserted_at: ~U[2026-01-01 00:00:00Z]])
    assert :ok = Accounts.request_code("owner@example.com")
    assert_receive {:community_code, "owner@example.com", code}
    assert {:ok, _, %User{role: "admin"}} = Accounts.verify("owner@example.com", code)
  end

  test "a sign-in does not keep the role of an address that is not in the list" do
    Repo.insert!(%User{
      email: "former@example.com",
      handle: "former",
      name: "Former",
      role: "admin"
    })

    assert :ok = Accounts.request_code("former@example.com")
    assert_receive {:community_code, "former@example.com", code}
    assert {:ok, token, %User{role: "member"}} = Accounts.verify("former@example.com", code)
    assert Repo.get_by!(User, email: "former@example.com").role == "member"
    assert %User{role: "member"} = Accounts.authenticate(token)
  end

  test "the list does not change the role of a moderator" do
    assert :ok = Accounts.request_code("helper@example.com")
    assert_receive {:community_code, "helper@example.com", code}
    assert {:ok, token, helper} = Accounts.verify("helper@example.com", code)
    assert :ok = StarsmapApi.Community.Operations.role(helper.handle, "moderator")
    assert %User{role: "moderator"} = Accounts.authenticate(token)
  end

  test "the operator command gives the admin role only to a listed address", %{user: user} do
    assert_raise RuntimeError, ~r/COMMUNITY_ADMIN_EMAILS/, fn ->
      StarsmapApi.Community.Operations.role(user.handle, "admin")
    end

    assert Repo.get!(User, user.id).role == "member"

    Application.put_env(:starsmap_api, :community_admin_emails, [user.email])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)
    assert :ok = StarsmapApi.Community.Operations.role(user.handle, "admin")
    assert Repo.get!(User, user.id).role == "admin"
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

  test "a notice keeps each value from a user on one line", %{user: user, subject: subject} do
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)
    deliver = &StarsmapApi.Community.AdminNotifier.perform/1

    # The handle pattern accepted a final newline before, so stored handles can have one.
    user =
      Repo.update!(
        Ecto.Changeset.change(user, handle: "author\n", name: "Author\nTime: yesterday")
      )

    photo =
      photo(user, subject, "review")
      |> Ecto.Changeset.change(
        title: "Moon\r\n\nApproved\u2028Open https://forged.example\u0085\u202Eend\u2029",
        declared_key: "moon\n"
      )
      |> Repo.update!()

    assert :ok =
             deliver.(%Oban.Job{
               args: %{"event" => "photo_review", "id" => photo.id, "to" => "owner@example.com"}
             })

    assert_receive {:community_notice, _, "Cosmic Atlas: photo waiting for review", text}
    lines = String.split(text, "\n")

    assert length(lines) == 9
    assert "Title: Moon Approved Open https://forged.example end" in lines
    assert "Photographer: author (Author Time: yesterday)" in lines
    refute text =~ ~r/[\r\x{85}\x{2028}\x{2029}\x{202E}]/u

    assert :ok =
             deliver.(%Oban.Job{
               args: %{"event" => "new_user", "id" => user.id, "to" => "owner@example.com"}
             })

    assert_receive {:community_notice, _, "Cosmic Atlas: new user", text}
    lines = String.split(text, "\n")
    assert "Handle: author" in lines
    assert "Name: Author Time: yesterday" in lines

    long = Repo.update!(Ecto.Changeset.change(photo, title: String.duplicate("a", 500)))

    assert :ok =
             deliver.(%Oban.Job{
               args: %{"event" => "photo_review", "id" => long.id, "to" => "owner@example.com"}
             })

    assert_receive {:community_notice, _, "Cosmic Atlas: photo waiting for review", text}
    assert ("Title: " <> String.duplicate("a", 200)) in String.split(text, "\n")
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

  test "a handle that ends with a newline is rejected", %{user: user} do
    assert {:error, changeset} =
             Accounts.update_profile(user, %{"name" => "Author", "handle" => "valid-handle\n"})

    assert changeset.errors[:handle]
    assert Repo.get!(User, user.id).handle == "author"

    assert {:ok, %User{handle: "valid-handle"}} =
             Accounts.update_profile(user, %{"name" => "Author", "handle" => "valid-handle"})
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
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800),
        first_sign_in_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
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

  describe "the reason of an anonymous report" do
    setup %{user: user, subject: subject} do
      %{photo: photo(user, subject, "published")}
    end

    test "counts characters in each language", %{photo: photo} do
      assert {:ok, _} = Moderation.report(photo.id, String.duplicate("報", 2000))
      assert {:ok, _} = Moderation.report(photo.id, "abc")
      assert {:error, :invalid_report} = Moderation.report(photo.id, "報")
      assert {:error, :invalid_report} = Moderation.report(photo.id, String.duplicate("報", 2001))
      assert {:error, :invalid_report} = Moderation.report(photo.id, nil)
      assert length(Moderation.reports()) == 2
    end

    test "combining marks do not go past the byte limit", %{photo: photo} do
      assert {:error, :invalid_report} = Moderation.report(photo.id, long_marks())
      assert Moderation.reports() == []
    end
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

  test "a suspension refreshes the subjects of the account's photos and votes, and no other subject",
       %{user: user, subject: own_subject} do
    moderator =
      Repo.insert!(%User{
        email: "suspension-moderator@example.com",
        handle: "suspension-moderator",
        name: "Moderator",
        role: "moderator"
      })

    other_author =
      Repo.insert!(%User{
        email: "other-author@example.com",
        handle: "other-author",
        name: "Other author"
      })

    # A vote has a weight only from an account with a first sign-in of more than one day ago.
    signed_in = DateTime.add(StarsmapApi.Community.now(), -172_800)
    user = Repo.update!(Ecto.Changeset.change(user, first_sign_in_at: signed_in))

    {:ok, voted_subject} = Subjects.ensure("mars")
    {:ok, unrelated_subject} = Subjects.ensure("venus")

    own = photo(user, own_subject, "published")
    first = photo(other_author, voted_subject, "published")
    voted = photo(other_author, voted_subject, "published")
    unrelated = photo(other_author, unrelated_subject, "published")
    Repo.insert!(%Vote{user_id: user.id, photo_id: voted.id})

    for subject <- [own_subject, voted_subject, unrelated_subject],
        do: Ranking.refresh(subject.id)

    assert cover_id(voted_subject) == voted.id
    assert cover_id(own_subject) == own.id
    version = Ranking.index(0).version

    {result, queries} =
      queries(fn -> Moderation.suspend(moderator, user.handle, "Abuse", true) end)

    assert {:ok, :ok} = result
    # The vote of a suspended account has no weight, so the older photo is the cover again.
    assert cover_id(voted_subject) == first.id
    assert cover_id(own_subject) == nil
    assert changed_subjects(version) == Enum.sort([own_subject.id, voted_subject.id])
    assert Enum.count(queries, &String.contains?(&1, ~s(INSERT INTO "subject_photo_stats"))) == 2
    assert cover_id(unrelated_subject) == unrelated.id

    version = Ranking.index(0).version
    assert {:ok, :ok} = Moderation.suspend(moderator, user.handle, "Appeal accepted", false)
    assert cover_id(voted_subject) == voted.id
    assert cover_id(own_subject) == own.id
    assert changed_subjects(version) == Enum.sort([own_subject.id, voted_subject.id])
  end

  test "the report queue builds the detail of a photo one time", %{user: user, subject: subject} do
    reported = photo(user, subject, "published")
    other = photo(user, subject, "published")

    assert {:ok, first} = Moderation.report(reported.id, "First reason")
    assert {:ok, _} = Moderation.report(other.id, "Other reason")
    assert {:ok, _} = Moderation.report(reported.id, "Second reason")
    assert {:ok, _} = Moderation.report(reported.id, "Third reason")

    {rows, queries} = queries(&Moderation.reports/0)

    assert Enum.map(rows, & &1.reason) ==
             ["First reason", "Other reason", "Second reason", "Third reason"]

    assert Enum.all?(rows, &(Map.keys(&1) |> Enum.sort() == [:at, :id, :photo, :reason]))
    assert hd(rows).id == first.id
    assert hd(rows).at == first.inserted_at
    assert Enum.map(rows, & &1.photo.id) == [reported.id, other.id, reported.id, reported.id]

    for row <- rows, do: assert(row.photo == Moderation.detail(Photos.get(row.photo.id)))

    assert length(hd(rows).photo.reports) == 3

    # One detail reads the open reports of its photo with one query.
    detail_queries =
      Enum.count(
        queries,
        &(String.contains?(&1, ~s(FROM "photo_reports")) and
            String.contains?(&1, "photo_id\" = $1"))
      )

    assert detail_queries == 2
  end

  describe "a moderation reason" do
    setup %{user: user, subject: subject} do
      moderator =
        Repo.insert!(%User{
          email: "reason-mod@example.com",
          handle: "reason-mod",
          name: "Moderator",
          role: "moderator"
        })

      %{moderator: moderator, photo: photo(user, subject, "review")}
    end

    test "out of range is invalid for a moderator and an admin", %{
      user: user,
      moderator: moderator,
      photo: photo
    } do
      admin = Repo.update!(Ecto.Changeset.change(moderator, role: "admin"))

      for actor <- [moderator, admin], reason <- ["ab", String.duplicate("a", 2001), nil] do
        assert {:error, :invalid_reason} = Moderation.review(actor, photo.id, "hide", reason)
        assert {:error, :invalid_reason} = Moderation.cancel_votes(actor, user.handle, reason)
        assert {:error, :invalid_reason} = Moderation.suspend(actor, user.handle, reason, true)
      end

      assert Photos.get(photo.id).status == "review"
      refute Repo.get!(User, user.id).suspended
      assert Moderation.log() == []
    end

    test "a member gets not_allowed for a valid and for an invalid reason", %{
      user: user,
      photo: photo
    } do
      for reason <- ["Valid reason", "ab", nil] do
        assert {:error, :not_allowed} = Moderation.review(user, photo.id, "hide", reason)
        assert {:error, :not_allowed} = Moderation.cancel_votes(user, user.handle, reason)
        assert {:error, :not_allowed} = Moderation.suspend(user, user.handle, reason, true)
      end
    end

    test "the limits of the range are valid", %{user: user, moderator: moderator, photo: photo} do
      assert {:ok, _} = Moderation.review(moderator, photo.id, "hide", "abc")

      assert {:ok, _} =
               Moderation.cancel_votes(moderator, user.handle, String.duplicate("a", 2000))

      assert {:ok, _} = Moderation.suspend(moderator, user.handle, "abc", true)
    end

    test "the range counts characters in each language", %{
      user: user,
      moderator: moderator,
      photo: photo
    } do
      assert {:ok, _} =
               Moderation.cancel_votes(moderator, user.handle, String.duplicate("理", 2000))

      assert {:error, :invalid_reason} = Moderation.review(moderator, photo.id, "hide", "理")

      assert {:error, :invalid_reason} =
               Moderation.review(moderator, photo.id, "hide", String.duplicate("理", 2001))
    end

    test "combining marks do not go past the byte limit", %{moderator: moderator, photo: photo} do
      assert {:error, :invalid_reason} =
               Moderation.review(moderator, photo.id, "hide", long_marks())

      assert Photos.get(photo.id).status == "review"
    end

    test "approval without a reason still gets the default text", %{
      moderator: moderator,
      photo: photo
    } do
      assert {:ok, _} = Moderation.review(moderator, photo.id, "approve", "")
    end

    test "with fewer than three visible characters is invalid", %{
      user: user,
      moderator: moderator,
      photo: photo
    } do
      for reason <- ["   ", "\t\n\r ", "\u00A0\u00A0\u00A0", "  a  ", " ab ", " 理 "] do
        assert {:error, :invalid_reason} = Moderation.review(moderator, photo.id, "hide", reason)

        assert {:error, :invalid_reason} =
                 Moderation.review(moderator, photo.id, "reject", reason)

        assert {:error, :invalid_reason} =
                 Moderation.cancel_votes(moderator, user.handle, reason)

        assert {:error, :invalid_reason} =
                 Moderation.suspend(moderator, user.handle, reason, true)

        assert {:error, :invalid_reason} =
                 Moderation.suspend(moderator, user.handle, reason, false)
      end

      assert Photos.get(photo.id).status == "review"
      refute Repo.get!(User, user.id).suspended
      assert Moderation.log() == []
    end

    test "keeps its spaces, and they count for the upper limit", %{
      moderator: moderator,
      photo: photo
    } do
      too_long = String.duplicate("a", 2000) <> " "
      assert {:error, :invalid_reason} = Moderation.review(moderator, photo.id, "hide", too_long)

      assert {:ok, _} = Moderation.review(moderator, photo.id, "hide", " abc ")
      assert [%{reason: " abc "}] = Moderation.log()
    end
  end

  describe "the removal of a photo by its photographer" do
    setup do
      moderator =
        Repo.insert!(%User{
          email: "removal-mod@example.com",
          handle: "removal-mod",
          name: "Moderator",
          role: "moderator"
        })

      %{moderator: moderator}
    end

    defp rejected_count(photo) do
      Moderation.detail(Photos.get(photo.id)).author.rejected
    end

    test "closes the open reports of that photo only", %{user: user, subject: subject} do
      removed = photo(user, subject, "published")
      kept = photo(user, subject, "published")

      assert {:ok, _} = Moderation.report(removed.id, "Wrong object")
      assert {:ok, _} = Moderation.report(removed.id, "Wrong credit")
      assert {:ok, _} = Moderation.report(kept.id, "Stolen picture")
      assert Moderation.counts()["reports"] == 3

      assert {:ok, :ok} = Moderation.remove(user, removed.id)

      assert Moderation.counts()["reports"] == 1
      assert [%{reason: "Stolen picture"}] = Moderation.reports()

      assert {:ok, :ok} = Moderation.remove(user, kept.id)
      assert Moderation.counts()["reports"] == 0
      assert Moderation.pending_count() == 0
    end

    test "is not a rejection in the statistics of the author", %{user: user, subject: subject} do
      removed = photo(user, subject, "published")
      later = photo(user, subject, "review")

      assert {:ok, :ok} = Moderation.remove(user, removed.id)

      assert rejected_count(later) == 0
      assert Moderation.detail(Photos.get(later.id)).author.published == 0
    end

    test "does not clear a rejection or a takedown", %{
      user: user,
      subject: subject,
      moderator: moderator
    } do
      rejected = photo(user, subject, "review")
      hidden = photo(user, subject, "published")
      later = photo(user, subject, "review")

      assert {:ok, _} = Moderation.review(moderator, rejected.id, "reject", "Wrong object")
      assert {:ok, _} = Moderation.review(moderator, hidden.id, "hide", "Stolen picture")
      assert rejected_count(later) == 2

      assert {:ok, :ok} = Moderation.remove(user, rejected.id)
      assert {:ok, :ok} = Moderation.remove(user, hidden.id)

      assert Photos.get(rejected.id).status == "hidden"
      assert rejected_count(later) == 2
    end

    test "after a moderator reversed a takedown is not a rejection", %{
      user: user,
      subject: subject,
      moderator: moderator
    } do
      restored = photo(user, subject, "published")
      later = photo(user, subject, "review")

      assert {:ok, _} = Moderation.review(moderator, restored.id, "hide", "Wrong object")
      assert {:ok, _} = Moderation.review(moderator, restored.id, "restore", "Our error")
      assert {:ok, :ok} = Moderation.remove(user, restored.id)

      assert rejected_count(later) == 0
    end

    test "by account deletion is not a rejection, but an earlier rejection stays", %{
      user: user,
      subject: subject,
      moderator: moderator
    } do
      published = photo(user, subject, "published")
      rejected = photo(user, subject, "review")

      assert {:ok, _} = Moderation.review(moderator, rejected.id, "reject", "Wrong object")
      assert {:ok, :ok} = StarsmapApi.Community.Privacy.erase(user)

      assert rejected_count(published) == 1
    end
  end

  describe "a moderator and their own photo" do
    setup %{user: user, subject: subject} do
      moderator =
        Repo.insert!(%User{
          email: "own-photo-mod@example.com",
          handle: "own-photo-mod",
          name: "Moderator",
          role: "moderator"
        })

      %{moderator: moderator, other_photo: photo(user, subject, "review")}
    end

    test "cannot approve or restore it, and nothing changes", %{
      moderator: moderator,
      subject: subject
    } do
      for {status, action} <- [
            {"review", "approve"},
            {"published", "approve"},
            {"hidden", "restore"},
            {"rejected", "restore"}
          ],
          reason <- ["", "Looks correct"] do
        own = photo(moderator, subject, status)

        assert {:error, :not_allowed} = Moderation.review(moderator, own.id, action, reason)
        assert Photos.get(own.id).status == status
      end

      assert Moderation.log() == []
    end

    test "cannot close a report of it with Keep photo", %{moderator: moderator, subject: subject} do
      own = photo(moderator, subject, "published")
      {:ok, report} = Moderation.report(own.id, "Wrong credit")

      assert {:error, :not_allowed} = Moderation.review(moderator, own.id, "approve", "")
      assert is_nil(Repo.reload!(report).resolved_at)
    end

    test "can still hide or reject it", %{moderator: moderator, subject: subject} do
      assert {:ok, %{status: "hidden"}} =
               Moderation.review(
                 moderator,
                 photo(moderator, subject, "published").id,
                 "hide",
                 "Wrong object"
               )

      assert {:ok, %{status: "rejected"}} =
               Moderation.review(
                 moderator,
                 photo(moderator, subject, "review").id,
                 "reject",
                 "Wrong object"
               )
    end

    test "can still approve and restore the photo of another author", %{
      moderator: moderator,
      other_photo: other_photo
    } do
      assert {:ok, %{status: "published"}} =
               Moderation.review(moderator, other_photo.id, "approve", "")

      assert {:ok, %{status: "hidden"}} =
               Moderation.review(moderator, other_photo.id, "hide", "Attribution review")

      assert {:ok, %{status: "published"}} =
               Moderation.review(moderator, other_photo.id, "restore", "")
    end

    test "a second moderator can approve it", %{moderator: moderator, subject: subject} do
      own = photo(moderator, subject, "review")

      second =
        Repo.insert!(%User{
          email: "second-mod@example.com",
          handle: "second-mod",
          name: "Second",
          role: "moderator"
        })

      assert {:ok, %{status: "published"}} = Moderation.review(second, own.id, "approve", "")
    end

    test "an admin can approve and restore their own photo", %{
      moderator: moderator,
      subject: subject
    } do
      admin = Repo.update!(Ecto.Changeset.change(moderator, role: "admin"))
      own = photo(admin, subject, "review")

      assert {:ok, %{status: "published"}} = Moderation.review(admin, own.id, "approve", "")
      assert {:ok, %{status: "hidden"}} = Moderation.review(admin, own.id, "hide", "Wrong object")
      assert {:ok, %{status: "published"}} = Moderation.review(admin, own.id, "restore", "")
    end
  end

  describe "the cancellation of votes" do
    setup %{user: user, subject: subject} do
      moderator =
        Repo.insert!(%User{
          email: "votes-mod@example.com",
          handle: "votes-mod",
          name: "Moderator",
          role: "moderator"
        })

      admin =
        Repo.insert!(%User{
          email: "votes-admin@example.com",
          handle: "votes-admin",
          name: "Admin",
          role: "admin"
        })

      %{moderator: moderator, admin: admin, published: photo(user, subject, "published")}
    end

    defp vote_count(voter),
      do: Repo.aggregate(from(v in Vote, where: v.user_id == ^voter.id), :count)

    test "does not reach an admin, and the votes remain", %{
      moderator: moderator,
      admin: admin,
      published: published
    } do
      Repo.insert!(%Vote{user_id: admin.id, photo_id: published.id})

      assert {:error, :not_allowed} =
               Moderation.cancel_votes(moderator, admin.handle, "Vote ring")

      assert vote_count(admin) == 1
      assert Moderation.log() == []
    end

    test "does not reach the actor, and the votes remain", %{
      moderator: moderator,
      admin: admin,
      published: published
    } do
      for actor <- [moderator, admin] do
        Repo.insert!(%Vote{user_id: actor.id, photo_id: published.id})

        assert {:error, :not_allowed} = Moderation.cancel_votes(actor, actor.handle, "Vote ring")
        assert vote_count(actor) == 1
      end

      assert Moderation.log() == []
    end

    test "still removes the votes of a member and of another moderator", %{
      moderator: moderator,
      published: published,
      user: user
    } do
      second =
        Repo.insert!(%User{
          email: "votes-second@example.com",
          handle: "votes-second",
          name: "Second",
          role: "moderator"
        })

      member =
        Repo.insert!(%User{email: "votes-member@example.com", handle: "voter", name: "Voter"})

      for target <- [second, member] do
        Repo.insert!(%Vote{user_id: target.id, photo_id: published.id})

        assert {:ok, :ok} = Moderation.cancel_votes(moderator, target.handle, "Vote ring")
        assert vote_count(target) == 0
      end

      assert {:ok, :ok} = Moderation.cancel_votes(moderator, user.handle, "No votes")
    end

    test "gives not_found for an unknown handle", %{moderator: moderator} do
      assert {:error, :not_found} = Moderation.cancel_votes(moderator, "nobody", "Vote ring")
    end
  end

  test "suspension keeps its rule for an admin and for the actor", %{user: user} do
    moderator =
      Repo.insert!(%User{
        email: "suspend-rule-mod@example.com",
        handle: "suspend-rule-mod",
        name: "Moderator",
        role: "moderator"
      })

    admin =
      Repo.insert!(%User{
        email: "suspend-rule-admin@example.com",
        handle: "suspend-rule-admin",
        name: "Admin",
        role: "admin"
      })

    assert {:error, :not_allowed} = Moderation.suspend(moderator, admin.handle, "Abuse", true)
    assert {:error, :not_allowed} = Moderation.suspend(moderator, moderator.handle, "Abuse", true)
    assert {:error, :not_found} = Moderation.suspend(moderator, "nobody", "Abuse", true)
    assert {:ok, :ok} = Moderation.suspend(admin, user.handle, "Abuse", true)
    refute Repo.get!(User, admin.id).suspended
    refute Repo.get!(User, moderator.id).suspended
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

  describe "the audit record of an account action" do
    setup do
      moderator =
        Repo.insert!(%User{
          email: "audit-mod@example.com",
          handle: "audit-mod",
          name: "Moderator",
          role: "moderator"
        })

      %{moderator: moderator}
    end

    defp audit_reasons, do: Repo.all(from a in Action, order_by: a.inserted_at, select: a.reason)

    defp legacy_action(actor, action, reason) do
      Repo.insert!(%Action{user_id: actor.id, action: action, reason: reason})
    end

    test "stores the ID of the target and shows its current handle", %{
      user: user,
      moderator: moderator
    } do
      assert {:ok, _} = Moderation.cancel_votes(moderator, user.handle, "Vote ring")
      assert {:ok, _} = Moderation.suspend(moderator, user.handle, "Repeated abuse", true)

      assert audit_reasons() == ["#{user.id}: Vote ring", "#{user.id}: Repeated abuse"]

      assert Moderation.log() |> Enum.map(& &1.reason) |> Enum.sort() ==
               ["author: Repeated abuse", "author: Vote ring"]

      Repo.update!(Ecto.Changeset.change(user, handle: "renamed"))

      assert Moderation.log() |> Enum.map(& &1.reason) |> Enum.sort() ==
               ["renamed: Repeated abuse", "renamed: Vote ring"]
    end

    test "names a suspension and a reinstatement differently", %{
      user: user,
      moderator: moderator
    } do
      assert {:ok, _} = Moderation.suspend(moderator, user.handle, "Repeated abuse", true)
      assert Repo.get!(User, user.id).suspended

      assert {:ok, _} = Moderation.suspend(moderator, user.handle, "Appeal accepted", false)
      refute Repo.get!(User, user.id).suspended

      entries = fn -> Moderation.log() |> Enum.map(&{&1.action, &1.reason}) |> Enum.sort() end

      assert entries.() == [
               {"suspend_account", "author: Repeated abuse"},
               {"unsuspend_account", "author: Appeal accepted"}
             ]

      assert audit_reasons() == ["#{user.id}: Repeated abuse", "#{user.id}: Appeal accepted"]

      # The log gets the current handle of the target for the new action too.
      Repo.update!(Ecto.Changeset.change(user, handle: "renamed"))

      assert entries.() == [
               {"suspend_account", "renamed: Repeated abuse"},
               {"unsuspend_account", "renamed: Appeal accepted"}
             ]
    end

    test "keeps no former handle after the account is erased", %{
      user: user,
      moderator: moderator
    } do
      assert {:ok, _} = Moderation.suspend(moderator, user.handle, "Repeated abuse", true)
      legacy_action(moderator, "suspend_account", "author: Older abuse")
      legacy_action(moderator, "cancel_votes", "author: Older vote ring")
      legacy_action(moderator, "unsuspend_account", "author: Older appeal")

      assert {:ok, :ok} = StarsmapApi.Community.Privacy.erase(user)

      refute Enum.any?(audit_reasons(), &String.contains?(&1, "author"))

      assert Enum.sort(audit_reasons()) ==
               Enum.sort([
                 "#{user.id}: Repeated abuse",
                 "#{user.id}: Older abuse",
                 "#{user.id}: Older vote ring",
                 "#{user.id}: Older appeal"
               ])

      assert Moderation.log() |> Enum.map(& &1.reason) |> Enum.sort() ==
               Enum.sort([
                 "deleted-#{user.id}: Repeated abuse",
                 "deleted-#{user.id}: Older abuse",
                 "deleted-#{user.id}: Older vote ring",
                 "deleted-#{user.id}: Older appeal"
               ])
    end

    test "erasure changes only the rows of that handle", %{user: user, moderator: moderator} do
      kept = [
        legacy_action(moderator, "suspend_account", "author-two: Other account"),
        legacy_action(moderator, "suspend_account", "coauthor: Other account"),
        legacy_action(moderator, "hide", "author: Free text of a photo decision"),
        legacy_action(moderator, "suspend_account", "Not the prefix: author: text")
      ]

      assert {:ok, :ok} = StarsmapApi.Community.Privacy.erase(user)

      assert Enum.sort(audit_reasons()) == kept |> Enum.map(& &1.reason) |> Enum.sort()
    end
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

  defp processing_photo(user, bytes) do
    source = Path.join(Storage.root(), "test-source-#{Ecto.UUID.generate()}")
    File.mkdir_p!(Path.dirname(source))
    File.write!(source, bytes)
    on_exit(fn -> File.rm(source) end)

    {:ok, photo} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => byte_size(bytes),
        "title" => "Moon fixture",
        "licence" => "All rights reserved",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    :ok = Storage.Local.put(photo.source_key, source, false)
    {:ok, processing} = Photos.complete(user, photo.id)
    processing
  end

  defp media_attempt(photo, attempt) do
    StarsmapApi.Community.MediaWorker.perform(%Oban.Job{
      args: %{"id" => photo.id},
      attempt: attempt,
      max_attempts: 3
    })
  end

  # The same end as an out-of-memory kill: the kernel stops the decoder with a signal.
  defp use_killed_decoder do
    root = Path.join(Storage.root(), "test-decoder-#{Ecto.UUID.generate()}")
    File.mkdir_p!(root)

    File.write!(
      Path.join(root, "community_media.py"),
      "import os, signal\nos.kill(os.getpid(), signal.SIGKILL)\n"
    )

    previous = Application.fetch_env!(:starsmap_api, :community_backend_root)
    Application.put_env(:starsmap_api, :community_backend_root, root)

    on_exit(fn ->
      Application.put_env(:starsmap_api, :community_backend_root, previous)
      File.rm_rf(root)
    end)
  end

  # A stopped orphan stays a zombie until PID 1 collects it. A zombie does not run.
  defp stopped?(pid, tries \\ 20) do
    case System.cmd("ps", ["-o", "stat=", "-p", pid]) do
      {stat, 0} ->
        if String.starts_with?(String.trim(stat), "Z") do
          true
        else
          if tries > 0 do
            Process.sleep(50)
            stopped?(pid, tries - 1)
          else
            false
          end
        end

      _ ->
        true
    end
  end

  defp cover_id(subject) do
    case Repo.one(
           from s in "subject_photo_stats",
             where: s.subject_id == type(^subject.id, Ecto.UUID),
             select: s.payload
         ) do
      %{"cover" => %{"id" => id}} -> id
      _ -> nil
    end
  end

  defp changed_subjects(version),
    do: Ranking.index(version).items |> Enum.map(& &1["subject_id"]) |> Enum.sort()

  # The SQL text of each query of the community database while `action` runs.
  defp queries(action) do
    handler = "community-test-queries-#{System.unique_integer([:positive])}"

    :telemetry.attach(
      handler,
      [:starsmap_api, :community_repo, :query],
      &__MODULE__.query_event/4,
      self()
    )

    try do
      result = action.()
      {result, received_queries([])}
    after
      :telemetry.detach(handler)
    end
  end

  def query_event(_event, _measurements, metadata, pid),
    do: send(pid, {:community_query, metadata.query})

  defp received_queries(queries) do
    receive do
      {:community_query, query} -> received_queries([query | queries])
    after
      0 -> Enum.reverse(queries)
    end
  end

  # Three characters with more than 8,000 bytes.
  defp long_marks, do: "a" <> String.duplicate("\u0301", 4000) <> "bc"

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
