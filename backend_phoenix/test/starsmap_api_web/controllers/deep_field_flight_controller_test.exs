defmodule StarsmapApiWeb.DeepFieldFlightControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  alias StarsmapApi.Community.{Accounts, DeepField, DeepFields, Photo, Storage, Subject, User}
  alias StarsmapApi.CommunityRepo, as: Repo
  alias StarsmapApi.Flights
  alias StarsmapApi.Flights.AnswerFlight

  @solved %{
    "status" => "solved",
    "projection" => "TAN",
    "frame" => "ICRS",
    "epoch" => "J2000",
    "ra_deg" => 150.0,
    "dec_deg" => 2.0,
    "pixel_scale_arcsec" => 4.0,
    "rotation_deg" => 0.0,
    "width" => 900,
    "height" => 600,
    "cd" => [-0.0011, 0.0, 0.0, 0.0011],
    "crpix" => [450.5, 300.5]
  }

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    Application.put_env(:starsmap_api, :community_test_mail_pid, self())
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_test_mail_pid) end)
    :ok
  end

  defp signed(email) do
    :ok = Accounts.request_code(email)
    assert_received {:community_code, ^email, code}
    {:ok, token, user} = Accounts.verify(email, code)
    {token, user}
  end

  defp as(conn, token) do
    conn
    |> put_req_cookie("cosmic-community", token)
    |> put_req_header("origin", "http://www.example.com")
    |> put_req_header("content-type", "application/json")
    |> put_req_header("x-community-csrf", Accounts.csrf(token))
  end

  defp subject do
    {:ok, subject} =
      StarsmapApi.Community.transaction(fn ->
        subject = Repo.insert!(%Subject{name: "Andromeda", object_type: "galaxy"})

        Repo.insert_all("subject_keys", [
          %{key: "ngc-224", subject_id: Ecto.UUID.dump!(subject.id)}
        ])

        subject
      end)

    subject
  end

  defp photo(user, subject, changes \\ []) do
    Repo.insert!(
      struct!(
        %Photo{
          user_id: user.id,
          subject_id: subject.id,
          declared_key: "ngc-224",
          title: "A <frame>",
          captured_at: StarsmapApi.Community.now(),
          licence: "CC BY 4.0",
          source_key: "uploads/#{System.unique_integer([:positive])}",
          size_bytes: 1,
          status: "published",
          wcs: @solved,
          published_at: StarsmapApi.Community.now()
        },
        changes
      )
    )
  end

  defp moderator(user) do
    Repo.update!(Ecto.Changeset.change(user, role: "moderator"))
  end

  test "a member cannot use the tools of a moderator", %{conn: conn} do
    {token, _} = signed("member@example.com")
    assert conn |> as(token) |> get("/api/community/review/deep-fields") |> json_response(403)

    assert conn
           |> as(token)
           |> post("/api/community/deep-fields", Jason.encode!(%{key: "ngc-224"}))
           |> json_response(403)
  end

  test "a signed-out visitor gets the forbidden error of a member, not a crash", %{conn: conn} do
    # Through the router, the session plug answers first.
    assert %{"error" => "sign_in_required"} =
             conn |> get("/api/community/review/deep-fields") |> json_response(401)

    # The controller itself also treats no user as a member.
    visitor = assign(conn, :community_user, nil)
    alias StarsmapApiWeb.DeepFieldController

    for answer <- [
          DeepFieldController.review(visitor, %{}),
          DeepFieldController.open(visitor, %{"key" => "ngc-224"}),
          DeepFieldController.close(visitor, %{"slug" => "andromeda"}),
          DeepFieldController.rebuild(visitor, %{"slug" => "andromeda"})
        ] do
      assert %{"error" => "not_allowed"} = json_response(answer, 403)
    end
  end

  test "a moderator opens a field, and the owner adds and removes a frame", %{conn: conn} do
    {mod_token, mod} = signed("mod@example.com")
    moderator(mod)
    {token, owner} = signed("owner@example.com")
    subject = subject()
    item = photo(owner, subject)

    review =
      conn |> as(mod_token) |> get("/api/community/review/deep-fields") |> json_response(200)

    assert [%{"key" => "ngc-224", "solved_photos" => 1}] = review["candidates"]

    assert %{"slug" => "andromeda"} =
             conn
             |> as(mod_token)
             |> post("/api/community/deep-fields", Jason.encode!(%{key: "ngc-224"}))
             |> json_response(200)

    assert %{"deep_field_open" => %{"slug" => "andromeda"}} =
             conn |> get("/api/photos/#{item.id}") |> json_response(200)

    state =
      conn
      |> as(token)
      |> get("/api/community/photos/#{item.id}/deep-frame")
      |> json_response(200)

    assert state["field"]["slug"] == "andromeda"
    assert state["frame"] == nil

    added =
      conn
      |> as(token)
      |> post("/api/community/photos/#{item.id}/deep-frame", Jason.encode!(%{future: true}))
      |> json_response(200)

    assert added["weight"] == nil
    me = conn |> as(token) |> get("/api/community/me") |> json_response(200)
    assert me["deep_field_future"] == true
    assert [%{"deep_field_open" => %{"slug" => "andromeda"}, "deep_frame" => %{}}] = me["photos"]

    assert %{"withdrawn_at" => at} =
             conn
             |> as(token)
             |> delete("/api/community/photos/#{item.id}/deep-frame", "{}")
             |> json_response(200)

    assert at

    assert %{"future" => false} =
             conn
             |> as(token)
             |> post("/api/community/deep-field-consent", Jason.encode!(%{future: false}))
             |> json_response(200)
  end

  test "a person cannot add the photo of another person", %{conn: conn} do
    {mod_token, mod} = signed("mod2@example.com")
    moderator(mod)
    {_, owner} = signed("owner2@example.com")
    {token, _} = signed("stranger@example.com")
    subject = subject()
    item = photo(owner, subject)

    conn
    |> as(mod_token)
    |> post("/api/community/deep-fields", Jason.encode!(%{key: "ngc-224"}))
    |> json_response(200)

    assert conn
           |> as(token)
           |> post("/api/community/photos/#{item.id}/deep-frame", "{}")
           |> json_response(404)
  end

  defp field_with_build(owner, other) do
    subject = subject()
    first = photo(owner, subject)
    second = photo(other, subject)

    moderator =
      Repo.insert!(%User{email: "m@e.com", handle: "moder", name: "M", role: "moderator"})

    {:ok, field} = DeepFields.open(moderator, "ngc-224")

    {:ok, _} =
      DeepFields.record(field, [first.id, second.id], %{
        "frames" => [%{"id" => first.id, "weight" => 0.5}, %{"id" => second.id, "weight" => 0.5}],
        "rejected" => [],
        "best_id" => first.id,
        "max_coverage" => 2,
        "limiting_mag" => 18.0,
        "best_limiting_mag" => 17.2,
        "gain_mag" => 0.8
      })

    Repo.get!(DeepField, field.id)
  end

  test "the page, the payload, and the current image are public", %{conn: conn} do
    owner = Repo.insert!(%User{email: "a@e.com", handle: "ada", name: "Ada <b>"})
    other = Repo.insert!(%User{email: "b@e.com", handle: "bea", name: "Bea"})
    field = field_with_build(owner, other)
    key = DeepFields.file_key(field, 1, "stack")
    File.mkdir_p!(Path.dirname(Storage.local_path(key)))
    File.write!(Storage.local_path(key), "webp")

    payload = conn |> get("/api/deep-fields/andromeda") |> json_response(200)
    assert payload["build"]["frames"] == 2
    assert length(payload["contributors"]) == 2

    html = conn |> get("/deep-field/andromeda") |> html_response(200)
    assert html =~ "Andromeda: deep field"
    assert html =~ "Ada &lt;b&gt;"
    refute html =~ "Ada <b>"

    assert conn |> get("/api/deep-fields/andromeda/media/1/stack") |> response(200) == "webp"
    assert conn |> get("/api/deep-fields/andromeda/media/2/stack") |> json_response(404)
    assert conn |> get("/api/deep-fields/andromeda/media/1/secret") |> json_response(404)
    assert conn |> get("/api/deep-fields/none") |> json_response(404)
    assert conn |> get("/deep-field/none") |> html_response(404)

    # The object inspector reads the same field.
    assert %{"deep_field" => %{"slug" => "andromeda", "frames" => 2}} =
             conn |> get("/api/objects/ngc-224/photos") |> json_response(200)
  end

  describe "media from S3" do
    setup do
      {:ok, listener} =
        :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])

      {:ok, {_, port}} = :inet.sockname(listener)
      storage = Application.fetch_env!(:starsmap_api, :community_storage)
      bucket = Application.get_env(:starsmap_api, :community_s3_bucket)

      aws =
        for key <- [:access_key_id, :secret_access_key, :region, :s3],
            do: {key, Application.get_env(:ex_aws, key)}

      Application.put_env(:starsmap_api, :community_storage, Storage.S3)
      Application.put_env(:starsmap_api, :community_s3_bucket, "media-bucket")
      Application.put_env(:ex_aws, :access_key_id, "test")
      Application.put_env(:ex_aws, :secret_access_key, "test")
      Application.put_env(:ex_aws, :region, "fsn1")
      Application.put_env(:ex_aws, :s3, scheme: "http://", host: "127.0.0.1", port: port)

      on_exit(fn ->
        :gen_tcp.close(listener)
        Application.put_env(:starsmap_api, :community_storage, storage)

        if bucket,
          do: Application.put_env(:starsmap_api, :community_s3_bucket, bucket),
          else: Application.delete_env(:starsmap_api, :community_s3_bucket)

        for {key, value} <- aws do
          if is_nil(value),
            do: Application.delete_env(:ex_aws, key),
            else: Application.put_env(:ex_aws, key, value)
        end
      end)

      {:ok, listener: listener}
    end

    test "the current image streams in chunks with the media headers", %{
      conn: conn,
      listener: listener
    } do
      owner = Repo.insert!(%User{email: "a@e.com", handle: "ada", name: "Ada"})
      other = Repo.insert!(%User{email: "b@e.com", handle: "bea", name: "Bea"})
      field = field_with_build(owner, other)
      key = DeepFields.file_key(field, 1, "stack")
      parts = for i <- 1..8, do: :binary.copy(<<i>>, 256 * 1024)
      server = s3_server(listener, 200, parts)

      response = conn |> get("/api/deep-fields/andromeda/media/1/stack")

      assert response.status == 200
      assert response.state == :chunked
      assert response.resp_body == IO.iodata_to_binary(parts)
      assert get_resp_header(response, "content-type") == ["image/webp; charset=utf-8"]
      assert get_resp_header(response, "x-content-type-options") == ["nosniff"]
      assert get_resp_header(response, "cache-control") == ["public, max-age=300"]

      request = Task.await(server)
      assert request =~ "GET /media-bucket/#{key}?"
      assert request =~ "X-Amz-Signature="
    end

    test "a stream that breaks after the status does not end as a complete image", %{
      conn: conn,
      listener: listener
    } do
      owner = Repo.insert!(%User{email: "a@e.com", handle: "ada", name: "Ada"})
      other = Repo.insert!(%User{email: "b@e.com", handle: "bea", name: "Bea"})
      field_with_build(owner, other)
      server = s3_server(listener, 200, [:binary.copy("x", 1024)], 4096)

      assert_raise RuntimeError, ~r/deep-field media stream failed: 3072 bytes missing/, fn ->
        get(conn, "/api/deep-fields/andromeda/media/1/stack")
      end

      Task.await(server)
    end

    test "a missing object is not found, and an old version does not reach S3", %{
      conn: conn,
      listener: listener
    } do
      owner = Repo.insert!(%User{email: "a@e.com", handle: "ada", name: "Ada"})
      other = Repo.insert!(%User{email: "b@e.com", handle: "bea", name: "Bea"})
      field_with_build(owner, other)

      # The build check runs before the read: no connection reaches the server.
      assert conn |> get("/api/deep-fields/andromeda/media/2/stack") |> json_response(404)
      assert {:error, :timeout} = :gen_tcp.accept(listener, 100)

      server = s3_server(listener, 404, ["<Error><Code>NoSuchKey</Code></Error>"])
      missing = conn |> get("/api/deep-fields/andromeda/media/1/stack")
      assert missing.status == 404
      assert Jason.decode!(missing.resp_body) == %{"error" => "not_found"}
      Task.await(server)
    end
  end

  # A server that answers like S3 and sends the body in separate writes.
  # A `length` larger than the parts closes the connection before the end of the body.
  defp s3_server(listener, status, parts, length \\ nil) do
    Task.async(fn ->
      {:ok, socket} = :gen_tcp.accept(listener, 5_000)
      request = s3_request(socket, "")
      length = length || parts |> IO.iodata_to_binary() |> byte_size()

      :ok =
        :gen_tcp.send(socket, [
          "HTTP/1.1 #{status} Test\r\n",
          "content-type: image/webp\r\n",
          "content-length: #{length}\r\n",
          "connection: close\r\n\r\n"
        ])

      for part <- parts, do: :ok = :gen_tcp.send(socket, part)
      :gen_tcp.close(socket)
      request
    end)
  end

  defp s3_request(socket, acc) do
    {:ok, data} = :gen_tcp.recv(socket, 0, 5_000)
    acc = acc <> data
    if String.contains?(acc, "\r\n\r\n"), do: acc, else: s3_request(socket, acc)
  end

  test "a view link of a moving body is an error, not a crash", %{conn: conn} do
    assert %{"error" => %{"code" => "coordinates_not_available"}} =
             conn |> get("/api/agent/v1/view-link?object_key=mars") |> json_response(400)
  end

  describe "answer flights" do
    setup do
      Application.put_env(:starsmap_api, :answer_flight_api_key, "test-key")
      on_exit(fn -> Application.delete_env(:starsmap_api, :answer_flight_api_key) end)
    end

    defp post_question(conn, question, locale \\ "en") do
      conn
      |> put_req_header("origin", "http://www.example.com")
      |> put_req_header("content-type", "application/json")
      |> post("/api/flights", Jason.encode!(%{question: question, locale: locale}))
    end

    test "the config tells the client when the form can work", %{conn: conn} do
      assert %{"flights" => true} = conn |> get("/api/community/config") |> json_response(200)
      Application.delete_env(:starsmap_api, :answer_flight_api_key)
      assert %{"flights" => false} = conn |> get("/api/community/config") |> json_response(200)
    end

    test "a question gives a stable address that the client polls", %{conn: conn} do
      body = conn |> post_question("How far is Andromeda?") |> json_response(202)
      assert body["status"] == "queued"
      assert body["slug"] == "answer-" <> body["flight"]

      assert %{"status" => "queued"} =
               conn |> get("/api/flights/#{body["flight"]}") |> json_response(200)

      assert conn |> get("/api/flights/none") |> json_response(404)
    end

    test "a write from another origin is refused", %{conn: conn} do
      assert conn
             |> put_req_header("origin", "https://evil.example")
             |> put_req_header("content-type", "application/json")
             |> post("/api/flights", ~s({"question":"How far is Mars?","locale":"en"}))
             |> json_response(403)
    end

    test "errors have codes that the client can read", %{conn: conn} do
      assert %{"error" => "question_rejected"} =
               conn |> post_question("short") |> json_response(422)

      Application.put_env(:starsmap_api, :answer_flight_daily_usd, 0.0)
      on_exit(fn -> Application.delete_env(:starsmap_api, :answer_flight_daily_usd) end)

      assert %{"error" => "flights_daily_limit"} =
               conn |> post_question("How far is Saturn?") |> json_response(429)
    end

    test "a published flight has a public page that stays out of search", %{conn: conn} do
      flight =
        Repo.insert!(%AnswerFlight{
          slug: "abc123",
          question: "How far is <Mars>?",
          normalized_question: "how far is <mars>",
          locale: "en",
          status: "published",
          title: "To Mars",
          steps: %{
            "steps" => [
              %{
                "title" => "Mars",
                "view_state" => "v=1&c=0%2C0&z=24&t=now",
                "sentences" => [
                  [
                    %{"kind" => "text", "text" => "It is "},
                    %{"kind" => "fact", "value" => 1.5, "unit" => "au", "keys" => ["mars"]}
                  ]
                ],
                "sources" => [
                  %{"key" => "mars", "name" => "Mars", "catalog" => "JPL", "url" => "/o/mars"}
                ]
              }
            ]
          }
        })

      response = conn |> get("/flights/#{flight.slug}")
      html = html_response(response, 200)
      assert get_resp_header(response, "x-robots-tag") == ["noindex"]
      assert html =~ "How far is &lt;Mars&gt;?"
      assert html =~ "/?tour=answer-abc123&amp;step=0"
      assert html =~ "It is 1.5 au"
      assert html =~ "/o/mars"

      assert conn |> get("/flights/none") |> html_response(404)
      {:ok, _} = Flights.hide(flight.slug)
      assert conn |> get("/flights/#{flight.slug}") |> html_response(404)
    end
  end
end
