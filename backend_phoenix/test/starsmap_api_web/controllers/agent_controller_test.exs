defmodule StarsmapApiWeb.AgentControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  alias StarsmapApi.Catalog.PublicCache

  setup do
    PublicCache.clear()
    :ok
  end

  test "about page is a factual no-JavaScript explanation with matching JSON-LD", %{conn: conn} do
    body = conn |> get(~p"/about") |> html_response(200)

    assert body =~ "public, browser-based 2D interactive celestial atlas"
    assert body =~ "heliocentric ecliptic map"
    assert body =~ "Gaia"
    assert body =~ "eROSITA-DE DR2"
    assert body =~ "SDSS-V DR20"
    assert body =~ "does not require signup, installation, or payment"
    assert body =~ "up to 8000 pixels wide"
    assert body =~ "not a calibrated survey image"
    assert body =~ ~s(<a href="/agents">Guide for AI agents</a>)
    assert body =~ ~s(<link rel="canonical" href="https://skychart.org/about">)

    [json_ld] = json_ld_documents(body)
    graph = json_ld["@graph"]
    assert Enum.find(graph, &(&1["@type"] == "WebSite"))["description"] =~ "SkyChart"

    application = Enum.find(graph, &(&1["@type"] == "WebApplication"))
    assert application["isAccessibleForFree"] == true
    assert application["description"] =~ "public, browser-based 2D interactive celestial atlas"
  end

  test "agent guide exposes recommendation boundaries, exact links, and interfaces in HTML", %{
    conn: conn
  } do
    body = conn |> get(~p"/agents") |> html_response(200)

    assert body =~ "Canonical description"
    assert body =~ "When is SkyChart appropriate to recommend?"
    assert body =~ "When should SkyChart not be the recommendation?"
    assert body =~ "https://skychart.org/o/ngc-224"
    assert body =~ "/api/agent/v1/view-link"
    assert body =~ "Do not invent layer names or URL parameters"
    assert body =~ "does not publish an MCP endpoint"
    assert body =~ "2026-08-31"
    assert body =~ ~s(rel="alternate" type="application/json" href="/agents.json")
    assert body =~ ~s(rel="service-desc" type="application/vnd.oai.openapi+json;version=3.1")
    assert body =~ ~s(<link rel="canonical" href="https://skychart.org/agents">)

    [json_ld] = json_ld_documents(body)
    assert json_ld["@type"] == "TechArticle"
    assert json_ld["dateModified"] == "2026-08-31"
    assert json_ld["description"] =~ "Gaia"
  end

  test "machine-readable guide, llms index, and OpenAPI point back to canonical HTML", %{
    conn: conn
  } do
    guide = conn |> get(~p"/agents.json") |> json_response(200)
    assert guide["canonical_url"] == "https://skychart.org/agents"
    assert guide["api"]["read_only"] == true
    assert guide["api"]["bounded"] == true
    assert guide["mcp"] == %{"available" => false, "reviewed" => "2026-08-31"}

    llms_conn = conn |> recycle() |> get(~p"/llms.txt")
    assert get_resp_header(llms_conn, "content-type") == ["text/plain; charset=utf-8"]
    llms = response(llms_conn, 200)
    assert llms =~ "https://skychart.org/about"
    assert llms =~ "https://skychart.org/agents"
    assert llms =~ "https://skychart.org/openapi.json"
    refute llms =~ "/o/ngc-224\n-"

    openapi_conn = conn |> recycle() |> get(~p"/openapi.json")

    assert hd(get_resp_header(openapi_conn, "content-type")) =~
             "application/vnd.oai.openapi+json"

    openapi = openapi_conn |> response(200) |> Jason.decode!()
    assert openapi["openapi"] == "3.1.0"
    assert openapi["externalDocs"]["url"] == "https://skychart.org/agents"

    assert Map.keys(openapi["paths"]) |> Enum.sort() ==
             Enum.sort([
               "/api/agent/v1/catalogs",
               "/api/agent/v1/objects/search",
               "/api/agent/v1/objects/{key}",
               "/api/agent/v1/view-link"
             ])
  end

  test "static pages sitemap is advertised and contains normally linked discovery pages", %{
    conn: conn
  } do
    base = StarsmapApiWeb.Endpoint.url()
    index = conn |> get(~p"/sitemap.xml") |> response(200)
    assert index =~ base <> "/sitemaps/pages.xml"

    pages = conn |> recycle() |> get(~p"/sitemaps/pages.xml") |> response(200)
    assert pages =~ base <> "/about"
    assert pages =~ base <> "/agents"
    assert pages =~ "<lastmod>2026-08-31</lastmod>"
  end

  test "source discovery files keep standards-compliant crawlers open and link the guide normally" do
    project_root = Path.expand("../../../..", __DIR__)
    robots = File.read!(Path.join(project_root, "public/robots.txt"))
    homepage = File.read!(Path.join(project_root, "index.html"))

    assert robots =~ "User-agent: *"
    assert robots =~ "Allow: /agents"
    assert robots =~ "Allow: /llms.txt"
    assert robots =~ "Allow: /openapi.json"
    assert robots =~ "Allow: /api/agent/"
    assert robots =~ "Sitemap: https://skychart.org/sitemap.xml"
    refute robots =~ ~r/User-agent: (GPTBot|ClaudeBot|OAI-SearchBot|PerplexityBot)/
    assert homepage =~ ~s(<a href="/agents">Guide for AI agents</a>)
  end

  defp json_ld_documents(body) do
    ~r/<script type="application\/ld\+json">(.*?)<\/script>/s
    |> Regex.scan(body, capture: :all_but_first)
    |> Enum.map(fn [encoded] -> Jason.decode!(encoded) end)
  end
end
