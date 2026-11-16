defmodule StarsmapApiWeb.MarketingPageControllerTest do
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApi.{AgentSkyFixtures, Mcp.Tools, Spacecraft, Analytics, Repo}
  alias StarsmapApiWeb.{MarketingPageController, Plugs.RateLimit}
  import Ecto.Query

  setup do
    RateLimit.reset()
    AgentSkyFixtures.stub_scientific_service()
    AgentSkyFixtures.seed_catalog()
    :ok
  end

  test "public guide retains all tools and its four examples execute", %{conn: conn} do
    page = conn |> get("/mcp-guide") |> html_response(200)
    for name <- Tools.names(), do: assert(page =~ name)

    for call <- MarketingPageController.examples() do
      assert {:ok, result} = Tools.call(call.name, Jason.decode!(Jason.encode!(call.arguments)))
      refute Map.has_key?(result, :error)

      if call.name == "create_object_sky_link" do
        assert result.url =~ "source=mcp"
        assert result.url =~ "mars"
        assert result.url =~ "2026-11-15"
      end
    end

    assert conn |> recycle() |> get("/mcp") |> json_response(405)
    assert conn |> recycle() |> get("/agents") |> html_response(200) =~ "/mcp-guide"
  end

  test "fleet identities, gaps and all five detail routes come from the manifest", %{conn: conn} do
    manifest = Spacecraft.public_manifest()
    page = conn |> get("/spacecraft") |> html_response(200)
    for craft <- manifest["spacecraft"], do: assert(page =~ "data-key=\"#{craft["key"]}\"")

    for item <- manifest["excluded"],
        do: assert(page =~ StarsmapApiWeb.StaticPage.escape(item["reason"]))

    assert page =~ "five-minute"
    assert page =~ "299,792.458"

    for {slug, key} <- MarketingPageController.crafts() do
      assert {:ok, _} = Spacecraft.get(key)
      detail = conn |> recycle() |> get("/spacecraft/#{slug}") |> html_response(200)
      assert detail =~ key
      assert detail =~ "No position loaded"
      assert detail =~ "rel=\"canonical\""
    end

    assert conn |> recycle() |> get("/spacecraft/not-real") |> html_response(404)
  end

  test "sitemap includes only public entry pages and shared results have privacy headers", %{
    conn: conn
  } do
    pages = conn |> get("/sitemaps/pages.xml") |> response(200)

    for path <- [
          "/mcp-guide",
          "/spacecraft/voyager-1",
          "/tonight",
          "/targets",
          "/tours/sun-to-survey-field"
        ],
        do: assert(pages =~ path)

    refute pages =~ "/targets/r/"
    shared = conn |> recycle() |> get("/targets/r/" <> String.duplicate("a", 32))
    assert get_resp_header(shared, "x-robots-tag") == ["noindex, nofollow"]
    assert get_resp_header(shared, "referrer-policy") == ["no-referrer"]
    refute html_response(shared, 200) =~ "rel=\"canonical\""
  end

  test "measurement stores aggregates without result tokens or site coordinates" do
    token = String.duplicate("a", 32)

    assert {:ok, event} =
             Analytics.record(
               %{
                 "name" => "calculation_completed",
                 "path" => "/targets/r/#{token}?latitude=1",
                 "properties" => %{"tool" => "match", "source" => "targets"}
               },
               {127, 0, 0, 1}
             )

    assert event.path == "/targets/r/:result"
    refute inspect(event) =~ token

    assert {:error, _} =
             Analytics.record(
               %{
                 "name" => "calculation_completed",
                 "path" => "/tonight",
                 "properties" => %{"latitude" => "1"}
               },
               {127, 0, 0, 1}
             )

    assert Repo.one(
             from e in Analytics.Event,
               where: e.event_name == "calculation_completed",
               select: count(e.id)
           ) == 1
  end
  test "successful MCP initialization is counted but owner probes and errors are excluded", %{conn: conn} do
    message = %{jsonrpc: "2.0", id: 1, method: "initialize", params: %{protocolVersion: "2025-11-25", capabilities: %{}, clientInfo: %{name: "fixture", version: "1"}}}
    response = conn |> put_req_header("content-type", "application/json") |> post("/mcp", Jason.encode!(message))
    assert json_response(response, 200)["result"]
    assert Repo.one(from e in Analytics.Event, where: e.event_name == "mcp_request", select: count(e.id)) == 1
    probe = build_conn() |> put_req_header("content-type", "application/json") |> put_req_header("x-atlas-measurement", "owner-test") |> post("/mcp", Jason.encode!(message))
    assert json_response(probe, 200)["result"]
    error = build_conn() |> put_req_header("content-type", "application/json") |> post("/mcp", Jason.encode!(%{jsonrpc: "2.0", id: 2, method: "tools/call", params: %{name: "search_sky_objects", arguments: %{q: "a"}}}))
    assert json_response(error, 200)["result"]["isError"]
    assert Repo.one(from e in Analytics.Event, where: e.event_name == "mcp_request", select: count(e.id)) == 1
  end

end
