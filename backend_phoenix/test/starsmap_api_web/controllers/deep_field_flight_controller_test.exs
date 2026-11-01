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
