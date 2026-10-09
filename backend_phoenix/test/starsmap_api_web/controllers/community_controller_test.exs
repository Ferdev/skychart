defmodule StarsmapApiWeb.CommunityControllerTest do
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApi.Community.{Accounts, Photos, User, Subjects, Photo}
  alias StarsmapApi.CommunityRepo, as: Repo

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

  defp write(conn),
    do:
      conn
      |> put_req_header("origin", "http://www.example.com")
      |> put_req_header("content-type", "application/json")
end
