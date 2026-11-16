defmodule StarsmapApiWeb.MarketingPageController do
  use StarsmapApiWeb, :controller
  alias StarsmapApiWeb.{StaticPage, AssetResolver}
  alias StarsmapApi.{Spacecraft, Mcp.Tools}

  @crafts %{
    "voyager-1" => "spacecraft-31",
    "voyager-2" => "spacecraft-32",
    "jwst" => "spacecraft-170",
    "juno" => "spacecraft-61",
    "new-horizons" => "spacecraft-98"
  }
  def crafts, do: @crafts

  def examples do
    [
      %{name: "search_sky_objects", arguments: %{q: "Voyager 1", limit: 3}},
      %{
        name: "get_solar_system_positions",
        arguments: %{time: "2026-11-15T00:00:00Z", bodies: ["earth", "mars"]}
      },
      %{
        name: "measure_object_separation",
        arguments: %{from_key: "earth", to_key: "mars", time: "2026-11-15T00:00:00Z"}
      },
      %{
        name: "create_object_sky_link",
        arguments: %{observer_key: "mars", look_at_key: "earth", time: "2026-11-15T00:00:00Z"}
      }
    ]
  end

  def mcp(conn, _) do
    endpoint = StarsmapApiWeb.Endpoint.url() <> "/mcp"

    tools =
      Enum.map_join(Tools.list(), "", fn tool ->
        "<li><h3>#{h(tool.title)}</h3><code>#{h(tool.name)}</code><p>#{h(tool.description)}</p><details><summary>Arguments and bounds</summary><pre>#{h(Jason.encode!(tool.inputSchema, pretty: true))}</pre></details></li>"
      end)

    examples =
      Enum.map_join(examples(), "", fn call ->
        "<pre>#{h(Jason.encode!(%{jsonrpc: "2.0", id: 2, method: "tools/call", params: call}, pretty: true))}</pre>"
      end)

    config = Jason.encode!(%{mcpServers: %{skychart: %{url: endpoint}}}, pretty: true)

    body = """
    <h1>Connect your assistant to the sky</h1><p class="lede">Search catalog records, check geometric positions, and make atlas links with eleven read-only tools. No account or API key is required.</p>
    <h2>Connection</h2><p>Remote endpoint: <code>#{h(endpoint)}</code>. Transport: Streamable HTTP. Copy this address into your client's remote MCP connection.</p>
    <h3>Claude Desktop</h3><p>Open Customize → Connectors → Add custom connector. Give the connector a name and paste the endpoint above as the remote server URL and select No sign in. Use public HTTPS on port 443. Availability depends on your Claude plan and workspace policy.</p>
    <h3>Cursor</h3><p>Add this entry to your MCP configuration (<code>.cursor/mcp.json</code> for a project):</p><pre>#{h(config)}</pre>
    <h3>Other MCP clients</h3><p>Select Streamable HTTP, paste the endpoint, and select no authentication. Send initialize, then tools/list, then tools/call. The server is stateless; no session ID is required. A browser GET to /mcp returns 405 by design.</p>
    <h2>Try four calls</h2><p>Send these JSON-RPC messages after initialization. The fixed UTC epoch makes the examples repeatable. Use returned object keys without changing them.</p>#{examples}
    <h2>Tools and limits</h2><ul>#{tools}</ul>
    <h2>Read the result with its sources</h2><p>Positions use the atlas's heliocentric ecliptic frame. Separation is a three-dimensional straight line where both records have a physical position. Visibility is a geometric estimate, without weather or refraction. A cutout is an image, not a distance measurement.</p>
    <p>Bad arguments return a tool error. Missing coverage and temporary service failures remain explicit; they are not zero positions. Requests are rate limited. This service is for orientation and source discovery, not bulk downloads or authoritative observing predictions.</p>
    <p><a href="/methodology">Scientific methods</a> · <a href="/agents">Full agent guide</a></p>
    """

    render_page(
      conn,
      "MCP sky tools",
      "Connect a read-only MCP client to Cosmic Atlas. Search, positions, separation and source links.",
      "/mcp-guide",
      body,
      "guide"
    )
  end

  def fleet(conn, _) do
    manifest = Spacecraft.public_manifest()
    rows = Enum.map_join(manifest["spacecraft"], "", &craft_row/1)
    excluded = manifest["excluded"] || []

    refusals =
      Enum.map_join(excluded, "", fn item ->
        "<li><strong>#{h(item["name"] || item["horizons_id"])}</strong>: #{h(item["reason"])} #{provider(item)}</li>"
      end)

    body = """
    <h1>Spacecraft in the atlas</h1><p class="lede">#{length(manifest["spacecraft"])} admitted spacecraft and #{length(excluded)} excluded records from the reviewed Horizons inventory.</p>
    <p>Inventory checked: #{h(manifest["retrieved_at"])}. Admission means that a trajectory was reviewed. It does not mean that the mission is active.</p>
    #{epoch_form()}#{science_note()}<p id="status" role="status">Loading spacecraft positions…</p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Spacecraft. Scroll horizontally to read all columns."><table><caption>Admitted spacecraft</caption><thead><tr><th>Spacecraft</th><th>Epoch and state</th><th>Earth distance</th><th>One-way light time</th><th>Sources</th></tr></thead><tbody>#{rows}</tbody></table></div>
    <h2>Records not placed</h2><p>These are the reasons recorded in the manifest. No position is inferred for these records.</p><ul>#{refusals}</ul>
    """

    render_page(
      conn,
      "Spacecraft positions and exclusions",
      "Check spacecraft positions, loaded epochs, light time and the records the atlas does not place.",
      "/spacecraft",
      body,
      "spacecraft"
    )
  end

  def spacecraft(conn, %{"slug" => slug}) do
    with key when is_binary(key) <- @crafts[slug], {:ok, craft} <- Spacecraft.get(key) do
      body = """
      <h1>Where is #{h(craft.name)}?</h1><p class="lede">Earth distance, Sun distance, estimated one-way light time and speed at the loaded epoch.</p>
      <p><a href="/spacecraft">All spacecraft and exclusions</a> · #{provider(craft.facts)}</p>#{epoch_form()}#{science_note()}
      <p id="status" role="status">Loading spacecraft position…</p><section id="craft-detail" data-key="#{h(key)}"><p>No position loaded yet.</p></section>
      """

      render_page(
        conn,
        "#{craft.name}: distance, light time and speed",
        "Check #{craft.name}'s epoch, Earth and Sun distances, one-way light time and relative speeds.",
        "/spacecraft/#{slug}",
        body,
        "spacecraft"
      )
    else
      _ -> conn |> put_status(:not_found) |> html(StaticPage.not_found())
    end
  end

  def tonight(conn, _) do
    body = """
    <h1>Tonight's transits</h1><p class="lede">Deep transits of bright hosts from the existing night planner. Set your site to calculate your observing window.</p>
    <p>Your site is saved in this browser and sent in the calculation request. It is not part of a share link. A recipient supplies their own site.</p>
    <section id="tonight"></section><noscript>Enable JavaScript to enter your site and calculate transits.</noscript>
    <p><a href="/methodology">Prediction sources and limits</a></p>
    """

    render_page(
      conn,
      "Tonight's exoplanet transits",
      "Find bright-host transit events for your site, open Sky, and start a timing through the existing login flow.",
      "/tonight",
      body,
      "tonight"
    )
  end

  def targets(conn, params) do
    shared = Map.has_key?(params, "token")
    conn = conn |> put_resp_header("referrer-policy", "no-referrer")
    conn = if shared, do: put_resp_header(conn, "x-robots-tag", "noindex, nofollow"), else: conn

    body = """
    <h1>Resolve an observing list</h1><p class="lede">Paste names or J2000 coordinates. Check ambiguous matches, export a sourced CSV, and open the matches on the map.</p>
    <p>Up to 500 rows from the catalogs already loaded. Decimal RA and Dec are degrees; sexagesimal RA is hours. TIC and other aliases work only when imported.</p>
    <section id="targets"></section><noscript>Enable JavaScript to match a list or read a shared result.</noscript>
    """

    render_page(
      conn,
      "Observing-list resolver",
      "Match names and sky coordinates to loaded catalog records, export their sources and share an immutable result.",
      if(shared, do: nil, else: "/targets"),
      body,
      "targets",
      if(shared, do: "noindex, nofollow", else: nil)
    )
  end

  defp craft_row(craft) do
    slug = Enum.find_value(@crafts, fn {slug, key} -> if key == craft["key"], do: slug end)

    name =
      if slug,
        do: "<a href=\"/spacecraft/#{slug}\">#{h(craft["name"])}</a>",
        else: h(craft["name"])

    "<tr data-key=\"#{h(craft["key"])}\"><th scope=\"row\">#{name}</th><td data-state>Loading</td><td data-distance>—</td><td data-light>—</td><td>#{provider(craft)}</td></tr>"
  end

  defp provider(record) do
    url =
      record["source_url"] ||
        (record["horizons_id"] &&
           "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&MAKE_EPHEM=NO&COMMAND=" <>
             URI.encode_www_form(record["horizons_id"]))

    if is_binary(url) and String.starts_with?(url, "https://"),
      do: "<a href=\"#{h(url)}\" rel=\"noreferrer\">NASA/JPL provider notes</a>",
      else: ""
  end

  defp epoch_form,
    do:
      "<form id=\"epoch-form\"><label>UTC epoch <input id=\"epoch\" type=\"datetime-local\" required step=\"300\"></label><button>Load epoch</button></form>"

  defp science_note,
    do:
      "<p class=\"technical\">Epochs round down to five-minute steps. One-way light time is geometric Earth distance divided by c (299,792.458 km/s), not a radio tracking solution. Sun and Earth speeds use their named reference frames. Daily-sample tickers interpolate between samples and can differ from this calculation. Outside coverage, no numbers are shown.</p>"

  defp render_page(conn, title, description, path, body, kind, robots \\ nil) do
    asset = AssetResolver.entry("src/marketing/page.ts")

    head =
      Enum.map_join(asset.css, "", &"<link rel=\"stylesheet\" href=\"#{h(&1)}\">") <>
        "<script type=\"module\" src=\"#{h(asset.script)}\"></script>"

    html(
      conn,
      StaticPage.document(
        title: title <> " — Cosmic Atlas",
        description: description,
        canonical: path && StarsmapApiWeb.Endpoint.url() <> path,
        robots: robots,
        head: head,
        body:
          "<nav aria-label=\"Site\">#{StaticPage.back_link()}<a href=\"/mcp-guide\">MCP</a><a href=\"/spacecraft\">Spacecraft</a><a href=\"/tonight\">Tonight</a><a href=\"/targets\">Target lists</a></nav><article data-marketing=\"#{kind}\">#{body}</article>"
      )
    )
  end

  defp h(value), do: StaticPage.escape(value || "")
end
