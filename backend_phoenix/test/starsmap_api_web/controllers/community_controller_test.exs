defmodule StarsmapApiWeb.CommunityControllerTest do
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApi.Community.{Accounts, Photos, User, Subjects, Photo}
  alias StarsmapApi.CommunityRepo, as: Repo

  defmodule FailingMailer do
    def deliver(_email, _code), do: {:error, :mail_unavailable}
  end

  setup do
    Application.put_env(:starsmap_api, :community_test_mail_pid, self())
    StarsmapApiWeb.Plugs.RateLimit.reset()
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_test_mail_pid) end)
    :ok
  end

  test "disabled feature reports its state without requiring the community database", %{
    conn: conn
  } do
    Application.put_env(:starsmap_api, :community_enabled, false)

    try do
      assert %{"enabled" => false} = conn |> get("/api/community/config") |> json_response(200)
      assert conn |> get("/api/photos/index") |> response(503)
    after
      Application.put_env(:starsmap_api, :community_enabled, true)
    end
  end

  test "anonymous session is cookieless and a foreign-origin code request fails", %{conn: conn} do
    assert %{"user" => nil} = conn |> get("/api/community/session") |> json_response(200)

    assert %{"error" => "origin_rejected"} =
             conn
             |> put_req_header("origin", "http://staging.example.com")
             |> put_req_header("content-type", "application/json")
             |> post("/api/community/code", %{email: "reader@example.com"})
             |> json_response(403)
  end

  test "a retry after a failed delivery reports the mail error, not a sent code", %{conn: conn} do
    mailer = Application.fetch_env!(:starsmap_api, :community_mailer)
    Application.put_env(:starsmap_api, :community_mailer, FailingMailer)
    on_exit(fn -> Application.put_env(:starsmap_api, :community_mailer, mailer) end)

    for _ <- 1..2 do
      assert %{"error" => "mail_unavailable"} =
               conn
               |> write()
               |> post("/api/community/code", %{email: "retry@example.com"})
               |> json_response(503)
    end
  end

  test "typed-code login sets an HttpOnly cookie and authenticated writes need CSRF", %{
    conn: conn
  } do
    :ok = Accounts.request_code("reader@example.com")
    assert_receive {:community_code, _, code}

    signed =
      write(conn) |> post("/api/community/verify", %{email: "reader@example.com", code: code})

    data = json_response(signed, 200)
    assert signed.resp_cookies["cosmic-community"].http_only
    token = signed.resp_cookies["cosmic-community"].value
    conn = build_conn() |> put_req_cookie("cosmic-community", token)

    assert %{"error" => "csrf_rejected"} =
             conn
             |> write()
             |> patch("/api/community/profile", %{name: "New name", handle: "reader"})
             |> json_response(403)

    assert %{"name" => "New name"} =
             conn
             |> write()
             |> put_req_header("x-community-csrf", data["csrf"])
             |> patch("/api/community/profile", %{name: "New name", handle: "reader"})
             |> json_response(200)
  end

  test "upload URLs are write-once, wrong sizes fail, and completion is idempotent", %{conn: conn} do
    :ok = Accounts.request_code("upload@example.com")
    assert_receive {:community_code, _, code}
    {:ok, token, user} = Accounts.verify("upload@example.com", code)

    {:ok, photo} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => 3,
        "title" => "Moon",
        "licence" => "All rights reserved",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    {:ok, upload} = StarsmapApi.Community.Storage.Local.intent(photo)

    conn =
      conn
      |> put_req_header("origin", "http://www.example.com")
      |> put_req_header("content-type", "application/octet-stream")

    assert conn |> put(upload.url, "abc") |> response(200)
    assert conn |> put(upload.url, "xyz") |> json_response(409)

    owner =
      build_conn()
      |> put_req_cookie("cosmic-community", token)
      |> write()
      |> put_req_header("x-community-csrf", Accounts.csrf(token))

    assert %{"status" => "processing"} =
             owner
             |> post("/api/community/photos/#{photo.id}/complete", %{})
             |> json_response(200)

    assert %{"status" => "processing"} =
             owner
             |> post("/api/community/photos/#{photo.id}/complete", %{})
             |> json_response(200)

    assert Repo.aggregate(Oban.Job, :count) == 1
  end

  test "private media and invalid identifiers do not leak", %{conn: conn} do
    assert conn |> get("/api/photos/not-a-uuid") |> json_response(404)
    assert conn |> get("/api/community/media/not-a-uuid/320") |> json_response(404)
    assert conn |> get("/o/moon") |> html_response(200) =~ "Moon"
  end

  test "moderator media reads still require a real photo identifier", %{conn: conn} do
    :ok = Accounts.request_code("media-mod@example.com")
    assert_receive {:community_code, _, code}
    {:ok, token, user} = Accounts.verify("media-mod@example.com", code)
    Repo.update!(Ecto.Changeset.change(user, role: "moderator"))

    assert conn
           |> put_req_cookie("cosmic-community", token)
           |> get("/api/community/media/not-a-photo/320")
           |> json_response(404)
  end

  test "object aliases share public galleries", %{conn: conn} do
    user = Repo.insert!(%User{email: "author@example.com", handle: "author", name: "Author"})
    {:ok, subject} = Subjects.ensure("moon")

    Repo.insert_all("subject_keys", [
      %{key: "test-alias", subject_id: Ecto.UUID.dump!(subject.id)}
    ])

    photo =
      Repo.insert!(%Photo{
        user_id: user.id,
        subject_id: subject.id,
        declared_key: "moon",
        title: "Moon photo",
        caption: "<script>private</script>",
        licence: "All rights reserved",
        captured_at: StarsmapApi.Community.now(),
        published_at: StarsmapApi.Community.now(),
        status: "published",
        source_key: "uploads/test",
        size_bytes: 3
      })

    a = conn |> get("/api/objects/moon/photos") |> json_response(200)
    b = conn |> get("/api/objects/test-alias/photos") |> json_response(200)
    assert a == b
    body = conn |> get("/photos/#{photo.id}") |> html_response(200)
    assert body =~ "&lt;script&gt;private&lt;/script&gt;"
    refute body =~ "<script>private</script>"
  end

  test "reviewed M31 and NGC keys share pages, credits and a removal delta", %{conn: conn} do
    StarsmapApi.Catalog.PublicCache.clear()
    on_exit(fn -> StarsmapApi.Catalog.PublicCache.clear() end)

    for key <- ["m31", "ngc-224"] do
      StarsmapApi.Catalog.SnapshotStore.upsert_source_objects([
        %{
          key: key,
          name: "Andromeda",
          aliases: ["M31", "NGC 224"],
          object_type: "galaxy",
          catalog_group: "messier_deep_sky",
          source_type: "deep_sky_catalog",
          position_model: "heasarc_neargalcat_j2000_distance_coordinates",
          search_text: "andromeda",
          ra_deg: 10.684,
          dec_deg: 41.269,
          distance_ly: 2_537_000.0,
          x_au: 1.0,
          y_au: 2.0,
          facts: %{},
          source: %{},
          external_ids: %{}
        }
      ])
    end

    user =
      Repo.insert!(%User{
        email: "m31-fixture@example.com",
        handle: "m31-fixture",
        name: "M31 Photographer"
      })

    {:ok, subject} = Subjects.ensure("m31")
    assert {:ok, other} = Subjects.ensure("ngc-224")
    assert subject.id == other.id

    p =
      Repo.insert!(%Photo{
        user_id: user.id,
        subject_id: subject.id,
        declared_key: "m31",
        title: "M31 fixture",
        caption: "",
        licence: "CC BY 4.0",
        captured_at: StarsmapApi.Community.now(),
        published_at: StarsmapApi.Community.now(),
        status: "published",
        source_key: "uploads/m31-fixture",
        size_bytes: 3
      })

    StarsmapApi.Community.transaction(fn -> StarsmapApi.Community.Ranking.refresh(subject.id) end)

    for key <- ["m31", "ngc-224"] do
      assert [%{"id" => id}] =
               (conn |> get("/api/objects/#{key}/photos") |> json_response(200))["photos"]

      assert id == p.id
      body = conn |> get("/o/#{key}") |> html_response(200)
      assert body =~ "M31 Photographer"
      assert body =~ "CC BY 4.0"
    end

    initial = conn |> get("/api/photos/index") |> json_response(200)
    assert {:ok, :ok} = StarsmapApi.Community.Moderation.remove(user, p.id)
    delta = conn |> get("/api/photos/index?since=#{initial["version"]}") |> json_response(200)
    assert [%{"cover" => nil, "count" => 0, "keys" => keys}] = delta["items"]
    assert "m31" in keys and "ngc-224" in keys
    assert conn |> get("/photos/#{p.id}") |> response(404)
  end

  test "review tools need a moderator, and a moderator gets the count of waiting work", %{
    conn: conn
  } do
    author = Repo.insert!(%User{email: "queue@example.com", handle: "queue", name: "Queue"})
    {:ok, subject} = Subjects.ensure("moon")

    waiting =
      Repo.insert!(%Photo{
        user_id: author.id,
        subject_id: subject.id,
        declared_key: "moon",
        title: "Waiting photo",
        caption: "",
        licence: "CC BY 4.0",
        captured_at: StarsmapApi.Community.now(),
        status: "review",
        source_key: "uploads/waiting",
        size_bytes: 3
      })

    :ok = Accounts.request_code("member@example.com")
    assert_receive {:community_code, "member@example.com", code}
    {:ok, token, member} = Accounts.verify("member@example.com", code)
    signed = fn -> build_conn() |> put_req_cookie("cosmic-community", token) end

    assert %{"review_count" => 0} =
             signed.() |> get("/api/community/session") |> json_response(200)

    for path <- ["/review", "/review/photos?status=review", "/review/log"] do
      assert %{"error" => "not_allowed"} =
               signed.() |> get("/api/community" <> path) |> json_response(403)
    end

    assert conn |> get("/api/community/review") |> json_response(401)
    # A photo that waits for review is not public, also for a signed-in member.
    assert conn |> get("/api/photos/#{waiting.id}") |> json_response(404)
    assert signed.() |> get("/api/community/media/#{waiting.id}/320") |> json_response(404)

    Repo.update!(Ecto.Changeset.change(member, role: "moderator"))

    assert %{"review_count" => 1} =
             signed.() |> get("/api/community/session") |> json_response(200)

    assert %{
             "counts" => %{"review" => 1, "reports" => 0},
             "photos" => [
               %{"title" => "Waiting photo", "status" => "review", "author" => author_data}
             ]
           } = signed.() |> get("/api/community/review") |> json_response(200)

    assert %{"handle" => "queue", "published" => 0} = author_data

    # Approval with no reason text publishes the photo.
    assert %{"status" => "published"} =
             signed.()
             |> write()
             |> put_req_header("x-community-csrf", Accounts.csrf(token))
             |> post("/api/community/photos/#{waiting.id}/review", %{action: "approve"})
             |> json_response(200)

    assert %{"photos" => [%{"id" => id}]} =
             signed.()
             |> get("/api/community/review/photos?status=published")
             |> json_response(200)

    assert id == waiting.id

    assert %{"actions" => [%{"action" => "approve", "photo_title" => "Waiting photo"}]} =
             signed.() |> get("/api/community/review/log") |> json_response(200)

    assert %{"photos" => [%{"id" => ^id, "object_name" => "Moon"}]} =
             conn |> get("/api/community/rankings?period=new") |> json_response(200)

    assert %{"photographer" => %{"handle" => "queue", "photos" => 1}, "photos" => [_]} =
             conn |> get("/api/community/photographers/queue") |> json_response(200)

    assert conn |> get("/api/community/photographers/nobody") |> json_response(404)

    # The moderator has an account and no photo: the page has zero in each number.
    assert %{"photographer" => %{"photos" => 0, "h_index" => 0}, "photos" => []} =
             conn |> get("/api/community/photographers/#{member.handle}") |> json_response(200)
  end

  test "an open session loses review access when the address leaves the list", %{conn: conn} do
    Application.put_env(:starsmap_api, :community_admin_emails, ["owner@example.com"])
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_admin_emails) end)

    :ok = Accounts.request_code("owner@example.com")
    assert_receive {:community_code, "owner@example.com", code}
    {:ok, token, _} = Accounts.verify("owner@example.com", code)
    signed = fn -> build_conn() |> put_req_cookie("cosmic-community", token) end

    assert %{"user" => %{"role" => "admin"}} =
             signed.() |> get("/api/community/session") |> json_response(200)

    assert signed.() |> get("/api/community/review") |> json_response(200)

    Application.put_env(:starsmap_api, :community_admin_emails, [])

    assert %{"error" => "not_allowed"} =
             signed.() |> get("/api/community/review") |> json_response(403)

    assert %{"user" => %{"role" => "member"}} =
             signed.() |> get("/api/community/session") |> json_response(200)

    assert Repo.get_by!(User, email: "owner@example.com").role == "member"
    assert conn |> get("/api/community/review") |> json_response(401)
  end

  test "policy pages have sections and links to each other", %{conn: conn} do
    body = conn |> get("/community/rules") |> html_response(200)
    assert body =~ "<h1>Community rules</h1>"
    assert body =~ "A moderator examines each photo before it becomes public."
    assert body =~ ~s(<strong aria-current="page">Community rules</strong>)
    assert body =~ ~s(<a href="/community/terms">Photo publishing terms</a>)
    assert body =~ ~s(<ol class="steps">)
    refute conn |> get("/community/terms") |> html_response(200) =~ "first three photos"
    assert conn |> get("/community/unknown") |> html_response(404)
  end

  defp write(conn),
    do:
      conn
      |> put_req_header("origin", "http://www.example.com")
      |> put_req_header("content-type", "application/json")

  describe "the Sky overlay" do
    setup do
      author =
        Repo.insert!(%User{email: "sky@example.com", handle: "sky-author", name: "Sky Author"})

      {:ok, subject} = Subjects.ensure("moon")
      {:ok, author: author, subject: subject}
    end

    defp solved(extra \\ %{}) do
      Map.merge(
        %{
          "ra_deg" => 10.0,
          "dec_deg" => 41.0,
          "pixel_scale_arcsec" => 3.6,
          "rotation_deg" => 0.0,
          "width" => 1600,
          "height" => 1200,
          "cd" => [-0.001, 0.0, 0.0, 0.001],
          "crpix" => [800.5, 600.5],
          "projection" => "TAN",
          "frame" => "ICRS",
          "epoch" => "J2000",
          "source" => "Astrometry.net",
          "status" => "solved"
        },
        extra
      )
    end

    defp photo(context, attrs) do
      Repo.insert!(
        struct!(
          %Photo{
            user_id: context.author.id,
            subject_id: context.subject.id,
            declared_key: "moon",
            title: "Sky photo",
            licence: "CC BY 4.0",
            captured_at: DateTime.utc_now(),
            source_key: "uploads/x",
            size_bytes: 10,
            status: "published",
            published_at: DateTime.utc_now(),
            wcs: solved()
          },
          attrs
        )
      )
    end

    defp overlay(conn, query \\ "ra=12&dec=40&radius=30"),
      do: conn |> get("/api/photos/sky?" <> query) |> json_response(200) |> Map.fetch!("photos")

    test "only a published photo with a solver solution is in the response", context do
      shown = photo(context, %{title: "Shown"})
      photo(context, %{title: "Hidden", status: "hidden"})
      photo(context, %{title: "Rejected", status: "rejected"})
      photo(context, %{title: "Waiting", status: "review"})
      photo(context, %{title: "Unsolved", wcs: nil})
      photo(context, %{title: "Author", wcs: solved(%{"status" => "author_supplied"})})
      photo(context, %{title: "No matrix", wcs: Map.delete(solved(), "cd")})
      photo(context, %{title: "Other frame", wcs: solved(%{"frame" => "FK4"})})

      assert [item] = overlay(context.conn)
      assert item["id"] == shown.id
      assert item["author"] == "Sky Author"
      assert item["image_url"] == "/api/community/media/#{shown.id}/1600"
      assert item["wcs"]["cd"] == [-0.001, 0.0, 0.0, 0.001]
      refute Map.has_key?(item, "caption") or Map.has_key?(item, "in_frame")
    end

    test "a photo of a suspended author leaves the overlay", context do
      photo(context, %{})
      assert [_] = overlay(context.conn)
      Repo.update!(Ecto.Changeset.change(context.author, suspended: true))
      assert [] = overlay(context.conn)
    end

    test "a footprint outside the area is not in the response", context do
      photo(context, %{wcs: solved(%{"ra_deg" => 200.0, "dec_deg" => -40.0})})
      assert [] = overlay(context.conn)
      assert [_] = overlay(context.conn, "ra=199&dec=-41&radius=1")
    end

    test "the area crosses right ascension zero", context do
      photo(context, %{wcs: solved(%{"ra_deg" => 359.0, "dec_deg" => 0.0})})
      assert [_] = overlay(context.conn, "ra=1&dec=0&radius=5")
    end

    test "the response has a limit, and an invalid area is refused", context do
      for _ <- 1..3, do: photo(context, %{})
      assert length(overlay(context.conn)) == 3
      assert StarsmapApi.Community.SkyOverlay.limit() == 200

      for query <- [
            "ra=400&dec=0&radius=10",
            "ra=1&dec=95&radius=10",
            "ra=1&dec=0",
            "ra=x&dec=0&radius=1"
          ] do
        assert %{"error" => "invalid_area"} =
                 context.conn |> get("/api/photos/sky?" <> query) |> json_response(400)
      end
    end
  end

  describe "shared tours" do
    @view "v=1&c=0,0&z=24&t=now&L=grid.1"

    setup %{conn: conn} do
      author = sign_in("tour-author@example.com")
      {:ok, conn: conn, author: author}
    end

    defp sign_in(email) do
      :ok = Accounts.request_code(email)
      assert_receive {:community_code, ^email, code}
      {:ok, token, user} = Accounts.verify(email, code)
      %{user: user, token: token, csrf: Accounts.csrf(token)}
    end

    defp as(conn, account) do
      conn
      |> put_req_cookie("cosmic-community", account.token)
      |> put_req_header("origin", "http://www.example.com")
      |> put_req_header("content-type", "application/json")
      |> put_req_header("x-community-csrf", account.csrf)
    end

    defp tour_body(extra \\ %{}) do
      Map.merge(
        %{
          title: "Lesson one",
          description: "A short lesson",
          steps: [
            %{viewState: @view, title: "Start", body: "<b>not markup</b>"},
            %{viewState: @view <> "&sky=earth&sc=10,10,40", title: "Sky", body: ""}
          ]
        },
        extra
      )
    end

    defp create(conn, account, extra \\ %{}) do
      conn |> as(account) |> post("/api/community/tours", tour_body(extra)) |> json_response(200)
    end

    defp token(tour), do: String.replace_prefix(tour["url"], "/?tour=shared-", "")

    defp public(conn, tour), do: get(conn, "/api/community/shared-tours/#{token(tour)}")

    defp report(conn, tour) do
      conn
      |> put_req_header("origin", "http://www.example.com")
      |> put_req_header("content-type", "application/json")
      |> post("/api/community/shared-tours/#{token(tour)}/report", %{reason: "not suitable"})
    end

    defp moderator do
      account = sign_in("tour-moderator@example.com")
      user = Repo.update!(Ecto.Changeset.change(account.user, role: "moderator"))
      %{account | user: user}
    end

    test "a tour opens signed out, with the step format of the player", %{
      conn: conn,
      author: author
    } do
      tour = create(conn, author)
      assert tour["url"] =~ ~r/^\/\?tour=shared-[0-9a-f]{32}$/

      payload = conn |> public(tour) |> json_response(200)
      assert payload["slug"] == "shared-" <> token(tour)
      assert payload["author"] == "Photographer"

      assert hd(payload["steps"]) == %{
               "viewState" => @view,
               "title" => "Start",
               "body" => "<b>not markup</b>"
             }

      refute Map.has_key?(payload, "user_id") or Map.has_key?(payload, "id")
    end

    test "only the author can change or delete a tour", %{conn: conn, author: author} do
      tour = create(conn, author)
      other = sign_in("other@example.com")

      assert conn
             |> as(other)
             |> patch("/api/community/tours/#{tour["id"]}", tour_body(%{title: "No"}))
             |> json_response(422)

      assert conn
             |> as(other)
             |> delete("/api/community/tours/#{tour["id"]}")
             |> json_response(422)

      changed =
        conn
        |> as(author)
        |> patch("/api/community/tours/#{tour["id"]}", tour_body(%{title: "Yes"}))
        |> json_response(200)

      assert changed["title"] == "Yes" and changed["url"] == tour["url"]

      assert conn
             |> as(author)
             |> delete("/api/community/tours/#{tour["id"]}")
             |> json_response(200)

      assert conn |> public(tour) |> json_response(404)
    end

    test "a signed-out person cannot create a tour", %{conn: conn} do
      response =
        conn
        |> put_req_header("origin", "http://www.example.com")
        |> put_req_header("content-type", "application/json")
        |> post("/api/community/tours", tour_body())

      assert json_response(response, 401)["error"] == "sign_in_required"
    end

    test "invalid tours are refused", %{conn: conn, author: author} do
      bad = [
        %{title: ""},
        %{title: String.duplicate("x", 121)},
        %{steps: []},
        %{steps: for(_ <- 1..31, do: %{viewState: @view, title: "x"})},
        %{steps: [%{viewState: "javascript:alert(1)", title: "x"}]},
        %{steps: [%{viewState: @view <> "&tour=other", title: "x"}]},
        %{steps: [%{viewState: "v=1&c=0&z=24&t=now&L=", title: "x"}]},
        %{steps: [%{viewState: "v=1&c=0,0&z=-1&t=now&L=", title: "x"}]},
        %{steps: [%{viewState: @view, title: ""}]}
      ]

      for extra <- bad do
        assert %{"error" => "invalid_tour"} =
                 conn
                 |> as(author)
                 |> post("/api/community/tours", tour_body(extra))
                 |> json_response(422)
      end
    end

    test "a report holds the tour until a moderator decides", %{conn: conn, author: author} do
      tour = create(conn, author)
      assert report(conn, tour) |> json_response(200)
      assert conn |> public(tour) |> json_response(404)

      mod = moderator()

      assert %{"tours" => [item]} =
               conn |> as(mod) |> get("/api/community/review/tours") |> json_response(200)

      assert item["status"] == "held"
      assert [%{"reason" => "not suitable"}] = item["reports"]

      assert %{"counts" => %{"tours" => 1}} =
               conn |> as(mod) |> get("/api/community/review") |> json_response(200)

      assert %{"review_count" => 1} =
               conn |> as(mod) |> get("/api/community/session") |> json_response(200)

      assert %{"status" => "shared"} =
               conn
               |> as(mod)
               |> post("/api/community/tours/#{tour["id"]}/review", %{action: "keep"})
               |> json_response(200)

      assert conn |> public(tour) |> json_response(200)

      assert %{"tours" => []} =
               conn |> as(mod) |> get("/api/community/review/tours") |> json_response(200)

      # A kept tour stays open after a new report, and the report waits in the queue.
      assert report(conn, tour) |> json_response(200)
      assert conn |> public(tour) |> json_response(200)

      assert %{"tours" => [_]} =
               conn |> as(mod) |> get("/api/community/review/tours") |> json_response(200)
    end

    test "a tour that a moderator hid stops opening and the author reads the reason", %{
      conn: conn,
      author: author
    } do
      tour = create(conn, author)
      mod = moderator()

      assert conn
             |> as(mod)
             |> post("/api/community/tours/#{tour["id"]}/review", %{
               action: "hide",
               reason: "Off topic"
             })
             |> json_response(200)

      assert conn |> public(tour) |> json_response(404)
      assert report(conn, tour) |> json_response(422)

      assert %{"tours" => [own]} =
               conn |> as(author) |> get("/api/community/tours") |> json_response(200)

      assert own["status"] == "hidden" and own["moderation_reason"] == "Off topic"

      assert %{"actions" => [%{"action" => "tour_hide", "photo_title" => "Lesson one"} | _]} =
               conn |> as(mod) |> get("/api/community/review/log") |> json_response(200)

      assert conn
             |> as(mod)
             |> post("/api/community/tours/#{tour["id"]}/review", %{action: "restore"})
             |> json_response(200)

      assert conn |> public(tour) |> json_response(200)
    end

    test "a member cannot review a tour", %{conn: conn, author: author} do
      tour = create(conn, author)

      assert conn
             |> as(author)
             |> post("/api/community/tours/#{tour["id"]}/review", %{
               action: "hide",
               reason: "Off topic"
             })
             |> json_response(422)

      assert conn |> as(author) |> get("/api/community/review/tours") |> json_response(403)
    end

    test "a tour of a suspended author does not open", %{conn: conn, author: author} do
      tour = create(conn, author)
      Repo.update!(Ecto.Changeset.change(author.user, suspended: true))
      assert conn |> public(tour) |> json_response(404)
    end

    test "the export has the tours and account removal deletes them", %{
      conn: conn,
      author: author
    } do
      tour = create(conn, author)

      assert %{"tours" => [exported]} =
               conn |> as(author) |> get("/api/community/export") |> json_response(200)

      assert exported["id"] == tour["id"] and length(exported["steps"]) == 2

      assert conn |> as(author) |> delete("/api/community/account") |> json_response(200)
      assert conn |> public(tour) |> json_response(404)
      assert Repo.aggregate(StarsmapApi.Community.Tour, :count) == 0
    end

    test "the shell of a shared tour has a noindex header", %{conn: conn} do
      response = get(conn, "/?tour=shared-0123456789abcdef0123456789abcdef")
      assert get_resp_header(response, "x-robots-tag") == ["noindex"]
    end
  end
end
