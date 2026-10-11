defmodule StarsmapApiWeb.McpControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  alias StarsmapApi.AgentSkyFixtures
  alias StarsmapApi.Mcp.Tools
  alias StarsmapApiWeb.Plugs.RateLimit

  @modern "2026-07-28"
  @version_key "io.modelcontextprotocol/protocolVersion"
  @capabilities_key "io.modelcontextprotocol/clientCapabilities"
  @server_info_key "io.modelcontextprotocol/serverInfo"

  @header_mismatch -32_020
  @unsupported_protocol_version -32_022

  setup do
    RateLimit.reset()
    AgentSkyFixtures.stub_scientific_service()
    AgentSkyFixtures.seed_catalog()
  end

  describe "transport" do
    test "accepts only POST and opens no stream or session", %{conn: conn} do
      for method <- [:get, :delete, :put] do
        response = conn |> recycle() |> dispatch(@endpoint, method, "/mcp")
        assert json_response(response, 405)["error"]["code"] == -32_600
        assert get_resp_header(response, "allow") == ["POST"]
      end

      response = modern(conn, "server/discover")
      assert json_response(response, 200)
      assert get_resp_header(response, "mcp-session-id") == []
      assert get_resp_header(response, "set-cookie") == []
      assert get_resp_header(response, "cache-control") == ["no-store"]
      assert hd(get_resp_header(response, "content-type")) =~ "application/json"
    end

    test "rejects a browser request from another origin", %{conn: conn} do
      foreign = conn |> put_req_header("origin", "https://attacker.example")

      assert json_response(modern(foreign, "server/discover"), 403)["error"]["message"] =~
               "Origin"

      assert conn
             |> recycle()
             |> put_req_header("origin", "https://attacker.example")
             |> get("/mcp")
             |> json_response(403)

      same = conn |> recycle() |> put_req_header("origin", StarsmapApiWeb.Endpoint.url())
      assert json_response(modern(same, "server/discover"), 200)
    end

    test "requires a JSON body and a client that accepts JSON", %{conn: conn} do
      text = conn |> put_req_header("content-type", "text/plain") |> post("/mcp", "{}")
      assert json_response(text, 415)["error"]["message"] =~ "application/json"

      html_only = conn |> recycle() |> put_req_header("accept", "text/html")
      assert json_response(modern(html_only, "server/discover"), 406)

      stream_only = conn |> recycle() |> put_req_header("accept", "text/event-stream")
      assert json_response(modern(stream_only, "server/discover"), 406)

      any = conn |> recycle() |> put_req_header("accept", "*/*")
      assert json_response(modern(any, "server/discover"), 200)
    end

    test "answers malformed, oversized, and batched bodies with JSON-RPC errors", %{conn: conn} do
      malformed = conn |> json_headers() |> post("/mcp", "{not json")
      assert %{"jsonrpc" => "2.0", "error" => error} = json_response(malformed, 400)
      assert error["code"] == -32_700
      refute Map.has_key?(json_response(malformed, 400), "id")

      oversized =
        conn |> recycle() |> json_headers() |> post("/mcp", String.duplicate(" ", 70_000))

      assert json_response(oversized, 413)["error"]["message"] =~ "too large"

      batch = conn |> recycle() |> json_headers() |> post("/mcp", "[]")
      assert json_response(batch, 400)["error"]["message"] =~ "Batch"

      for body <- [~s("text"), ~s({"jsonrpc":"1.0","id":1,"method":"ping"}), ~s({"id":1})] do
        invalid = conn |> recycle() |> json_headers() |> post("/mcp", body)
        assert json_response(invalid, 400)["error"]["code"] == -32_600
      end

      null_id = ~s({"jsonrpc":"2.0","id":null,"method":"tools/list"})
      assert conn |> recycle() |> json_headers() |> post("/mcp", null_id) |> json_response(400)
    end

    test "accepts notifications without a response body", %{conn: conn} do
      body = Jason.encode!(%{jsonrpc: "2.0", method: "notifications/initialized"})
      response = conn |> json_headers() |> post("/mcp", body)
      assert response(response, 202) == ""
    end

    test "limits each client separately from the JSON API", %{conn: conn} do
      # More than two windows of budget: one window gets more than its capacity
      # although a window boundary can fall between the requests.
      statuses = for _ <- 1..250, do: modern(recycle(conn), "server/discover").status

      assert 429 in statuses
      assert conn |> recycle() |> get(~p"/api/agent/v1/catalogs") |> json_response(200)
    end
  end

  describe "per-request protocol (2026-07-28)" do
    test "server/discover names the versions, the capabilities, and the server", %{conn: conn} do
      result = conn |> modern("server/discover") |> result!()

      assert result["resultType"] == "complete"

      assert result["supportedVersions"] == [
               "2026-07-28",
               "2025-11-25",
               "2025-06-18",
               "2025-03-26"
             ]

      assert result["capabilities"] == %{"tools" => %{}}
      assert result["instructions"] =~ "search_sky_objects"
      assert result["ttlMs"] > 0
      assert result["cacheScope"] == "public"
      assert %{"name" => "skychart", "version" => version} = result["_meta"][@server_info_key]
      assert is_binary(version)
    end

    test "tools/list returns the read-only tools in a stable order", %{conn: conn} do
      result = conn |> modern("tools/list") |> result!()

      assert result["resultType"] == "complete"
      assert result["cacheScope"] == "public"
      assert is_integer(result["ttlMs"])

      assert Enum.map(result["tools"], & &1["name"]) == [
               "search_sky_objects",
               "get_sky_object",
               "list_sky_catalogs",
               "create_sky_view_link",
               "create_object_sky_link",
               "get_solar_system_positions",
               "measure_object_separation",
               "get_object_visibility",
               "list_sky_events",
               "list_guided_tours"
             ]

      for tool <- result["tools"] do
        assert tool["name"] =~ ~r/^[a-z_]{1,64}$/
        assert tool["description"] =~ "not an authoritative archive"
        assert tool["inputSchema"]["type"] == "object"
        assert tool["inputSchema"]["additionalProperties"] == false
        assert is_map(tool["inputSchema"]["properties"])
        assert Enum.all?(tool["inputSchema"]["required"] || [], &is_binary/1)
        assert tool["annotations"]["readOnlyHint"] == true
        assert tool["annotations"]["destructiveHint"] == false
      end

      assert %{"error" => %{"code" => -32_602}} =
               conn
               |> recycle()
               |> modern("tools/list", %{"cursor" => "next"})
               |> json_response(200)
    end

    test "rejects a request whose headers and body disagree", %{conn: conn} do
      cases = [
        {[{"mcp-protocol-version", nil}], "MCP-Protocol-Version header is required"},
        {[{"mcp-protocol-version", "2025-11-25"}], "MCP-Protocol-Version header does not match"},
        {[{"mcp-method", nil}], "Mcp-Method header is required"},
        {[{"mcp-method", "tools/list"}], "Mcp-Method header does not match"},
        {[{"mcp-name", nil}], "Mcp-Name header is required"},
        {[{"mcp-name", "get_sky_object"}], "Mcp-Name header does not match"},
        {[{"mcp-name", "=?base64?%%%?="}], "Mcp-Name header is malformed"}
      ]

      for {headers, message} <- cases do
        response =
          conn
          |> recycle()
          |> modern("tools/call", %{"name" => "list_sky_catalogs"}, headers: headers)
          |> json_response(400)

        assert response["id"] == 1
        assert response["error"]["code"] == @header_mismatch
        assert response["error"]["message"] =~ message
      end
    end

    test "accepts a Base64 tool-name header", %{conn: conn} do
      encoded = "=?base64?" <> Base.encode64("list_sky_catalogs") <> "?="

      assert %{"isError" => false} =
               conn
               |> modern("tools/call", %{"name" => "list_sky_catalogs"},
                 headers: [{"mcp-name", encoded}]
               )
               |> result!()
    end

    test "rejects an unsupported version with the supported versions", %{conn: conn} do
      response =
        conn
        |> modern("tools/list", %{}, version: "2030-01-01")
        |> json_response(400)

      assert response["error"]["code"] == @unsupported_protocol_version
      assert response["error"]["data"]["requested"] == "2030-01-01"
      assert @modern in response["error"]["data"]["supported"]
      assert "2025-11-25" in response["error"]["data"]["supported"]

      # A version header that no revision defines, without request metadata.
      body = Jason.encode!(%{jsonrpc: "2.0", id: 7, method: "tools/list"})

      legacy =
        conn
        |> recycle()
        |> json_headers()
        |> put_req_header("mcp-protocol-version", "1999-01-01")
        |> post("/mcp", body)
        |> json_response(400)

      assert legacy["id"] == 7
      assert legacy["error"]["code"] == @unsupported_protocol_version
    end

    test "requires the request metadata", %{conn: conn} do
      for meta <- [
            %{},
            %{@version_key => @modern},
            %{@version_key => 5, @capabilities_key => %{}}
          ] do
        response =
          conn |> recycle() |> modern("tools/list", %{}, meta: meta) |> json_response(400)

        assert response["error"]["code"] == -32_602
        assert response["error"]["message"] =~ "params._meta"
      end
    end

    test "answers an unknown method with 404 and an unknown tool with invalid params", %{
      conn: conn
    } do
      for method <- ["resources/list", "ping", "initialize"] do
        response = conn |> recycle() |> modern(method) |> json_response(404)
        assert response["error"]["code"] == -32_601
      end

      unknown = conn |> recycle() |> modern("tools/call", %{"name" => "delete_everything"})
      assert %{"code" => -32_602, "message" => message} = json_response(unknown, 200)["error"]
      assert message =~ "Unknown tool: delete_everything"

      for params <- [%{}, %{"name" => "list_sky_catalogs", "arguments" => [1]}] do
        headers = [{"mcp-name", params["name"]}]

        response =
          conn |> recycle() |> modern("tools/call", params, headers: headers)

        status = if params == %{}, do: 400, else: 200
        assert json_response(response, status)["error"]["code"] in [-32_602, @header_mismatch]
      end
    end
  end

  describe "handshake protocol (2025-11-25 and earlier)" do
    test "initialize negotiates a legacy version without a session", %{conn: conn} do
      response =
        legacy(conn, "initialize", %{
          "protocolVersion" => "2025-06-18",
          "capabilities" => %{},
          "clientInfo" => %{"name" => "test-client", "version" => "1.0.0"}
        })

      result = result!(response)
      assert result["protocolVersion"] == "2025-06-18"
      assert result["capabilities"] == %{"tools" => %{}}
      assert result["serverInfo"]["name"] == "skychart"
      assert result["instructions"] =~ "read-only"
      refute Map.has_key?(result, "resultType")
      assert get_resp_header(response, "mcp-session-id") == []

      for unknown <- ["2024-11-05", "2026-07-28", nil] do
        params = %{"protocolVersion" => unknown, "capabilities" => %{}}

        assert result!(legacy(recycle(conn), "initialize", params))["protocolVersion"] ==
                 "2025-11-25"
      end
    end

    test "serves ping, tools/list, and tools/call under a negotiated version", %{conn: conn} do
      assert conn |> legacy("ping", %{}, version: "2025-11-25") |> result!() == %{}

      list = conn |> recycle() |> legacy("tools/list", %{}, version: "2025-06-18") |> result!()
      assert Enum.map(list["tools"], & &1["name"]) == Tools.names()
      refute Map.has_key?(list, "resultType")
      refute Map.has_key?(list, "ttlMs")

      call =
        conn
        |> recycle()
        |> legacy("tools/call", %{"name" => "list_sky_catalogs"}, version: "2025-06-18")
        |> result!()

      assert call["isError"] == false
      assert is_list(call["structuredContent"]["catalogs"])
      refute Map.has_key?(call, "resultType")

      missing =
        conn |> recycle() |> legacy("resources/list", %{}, version: "2025-06-18")

      assert json_response(missing, 200)["error"]["code"] == -32_601
    end

    test "treats a request without a version header as revision 2025-03-26", %{conn: conn} do
      call = conn |> legacy("tools/call", %{"name" => "list_sky_catalogs"}) |> result!()

      assert [%{"type" => "text", "text" => text}] = call["content"]
      assert is_list(Jason.decode!(text)["catalogs"])
      refute Map.has_key?(call, "structuredContent")
    end
  end

  describe "tools shared with the REST agent API" do
    test "return the same payloads as the REST operations", %{conn: conn} do
      contracts = [
        {"search_sky_objects", %{"q" => "Andromeda", "limit" => 1},
         ~p"/api/agent/v1/objects/search?q=Andromeda&limit=1"},
        {"get_sky_object", %{"key" => "NGC-224"}, ~p"/api/agent/v1/objects/ngc-224"},
        {"list_sky_catalogs", %{}, ~p"/api/agent/v1/catalogs"},
        {"create_sky_view_link",
         %{"object_key" => "ngc-224", "zoom" => 30, "layers" => ["grid", "labels"]},
         ~p"/api/agent/v1/view-link?object_key=ngc-224&zoom=30&layers=grid,labels"},
        {"create_sky_view_link",
         %{"center_x_au" => 1.5, "center_y_au" => -2.25, "time" => "2026-08-31T00:00:00Z"},
         ~p"/api/agent/v1/view-link?center_x_au=1.5&center_y_au=-2.25&time=2026-08-31T00:00:00Z"}
      ]

      for {tool, arguments, rest_path} <- contracts do
        rest = conn |> recycle() |> get(rest_path) |> json_response(200)
        result = call_tool(recycle(conn), tool, arguments)

        assert result["isError"] == false
        assert result["structuredContent"] == rest
        assert [%{"type" => "text", "text" => text}] = result["content"]
        assert Jason.decode!(text) == rest
      end
    end

    test "return the same errors as the REST operations, as tool results", %{conn: conn} do
      contracts = [
        {"search_sky_objects", %{"q" => "ab"}, ~p"/api/agent/v1/objects/search?q=ab", 400},
        {"search_sky_objects", %{"q" => "Andromeda", "limit" => 11},
         ~p"/api/agent/v1/objects/search?q=Andromeda&limit=11", 400},
        {"get_sky_object", %{"key" => "not-real"}, ~p"/api/agent/v1/objects/not-real", 404},
        {"create_sky_view_link",
         %{"center_x_au" => 0, "center_y_au" => 0, "layers" => ["invented"]},
         ~p"/api/agent/v1/view-link?center_x_au=0&center_y_au=0&layers=invented", 400}
      ]

      for {tool, arguments, rest_path, status} <- contracts do
        rest = conn |> recycle() |> get(rest_path) |> json_response(status)
        result = call_tool(recycle(conn), tool, arguments)

        assert result["isError"] == true
        assert result["structuredContent"] == rest
        assert [%{"type" => "text", "text" => text}] = result["content"]
        assert text == "#{rest["error"]["code"]}: #{rest["error"]["message"]}"
      end
    end

    test "reject arguments that a tool does not define", %{conn: conn} do
      result = call_tool(conn, "list_sky_catalogs", %{"format" => "csv"})

      assert result["isError"] == true
      assert result["structuredContent"]["error"]["code"] == "unknown_argument"
      assert result["structuredContent"]["error"]["parameter"] == "format"

      missing = call_tool(recycle(conn), "get_sky_object", %{})
      assert missing["structuredContent"]["error"]["code"] == "invalid_object_key"
    end
  end

  describe "sky tools" do
    test "get_solar_system_positions", %{conn: conn} do
      result =
        call_tool(conn, "get_solar_system_positions", %{
          "time" => "2026-10-10T00:00:00Z",
          "bodies" => ["mars", "spacecraft-31"]
        })

      assert result["isError"] == false

      assert %{"time_utc" => "2026-10-10T00:00:00Z", "bodies" => [mars, voyager]} =
               result["structuredContent"]

      assert mars["position_au"] == %{"x" => 1.0, "y" => 2.0, "z" => 0.0}
      assert voyager["name"] == "Voyager 1"

      invalid = call_tool(recycle(conn), "get_solar_system_positions", %{"bodies" => ["vulcan"]})
      assert invalid["isError"] == true
      assert invalid["structuredContent"]["error"]["code"] == "unknown_body"
    end

    test "measure_object_separation", %{conn: conn} do
      result =
        call_tool(conn, "measure_object_separation", %{"from_key" => "earth", "to_key" => "mars"})

      assert result["isError"] == false
      assert_in_delta result["structuredContent"]["separation"]["au"], 2.0, 1.0e-12
      assert result["structuredContent"]["to"]["object_url"] =~ "/o/mars"
    end

    test "create_object_sky_link", %{conn: conn} do
      result =
        call_tool(conn, "create_object_sky_link", %{
          "observer_key" => "mars",
          "look_at_key" => "earth",
          "time" => "2026-10-10T00:00:00Z",
          "hidden_object_types" => ["quasar"]
        })

      assert result["isError"] == false
      payload = result["structuredContent"]
      assert payload["url"] =~ "/sky/mars?"
      assert payload["parameters"]["yaw_deg"] == 270.0
      assert payload["looking_at"]["key"] == "earth"

      # The link that the tool returns is a link that the Sky page accepts.
      assert conn
             |> recycle()
             |> get(URI.parse(payload["url"]).path <> "?" <> URI.parse(payload["url"]).query)
             |> html_response(200)
    end

    test "get_object_visibility", %{conn: conn} do
      result =
        call_tool(conn, "get_object_visibility", %{
          "object_key" => "jupiter",
          "latitude_deg" => 40.4,
          "longitude_deg" => -3.7
        })

      assert result["isError"] == false
      assert result["structuredContent"]["altitude_deg"] == -24.8
      assert result["structuredContent"]["above_horizon"] == false

      missing =
        call_tool(recycle(conn), "get_object_visibility", %{
          "object_key" => "ngc-224",
          "latitude_deg" => 0,
          "longitude_deg" => 0
        })

      assert missing["structuredContent"]["error"]["code"] == "visibility_not_available"
    end

    test "list_sky_events and list_guided_tours", %{conn: conn} do
      events = call_tool(conn, "list_sky_events", %{"limit" => 5})
      assert events["isError"] == false
      assert %{"events" => [], "count" => 0, "stale" => true} = events["structuredContent"]

      tours = call_tool(recycle(conn), "list_guided_tours", %{})
      assert tours["isError"] == false
      assert Enum.any?(tours["structuredContent"]["tours"], &(&1["slug"] == "near-the-sun"))
    end

    test "reports a failed tool as a tool error and keeps the protocol answer", %{conn: conn} do
      AgentSkyFixtures.stub_scientific_service(AgentSkyFixtures.UnavailableEphemeris)

      result = call_tool(conn, "get_solar_system_positions", %{})
      assert result["isError"] == true
      assert result["structuredContent"]["error"]["code"] == "ephemeris_unavailable"
      assert result["resultType"] == "complete"
    end
  end

  defp call_tool(conn, name, arguments) do
    conn |> modern("tools/call", %{"name" => name, "arguments" => arguments}) |> result!()
  end

  defp result!(conn) do
    assert %{"jsonrpc" => "2.0", "id" => 1, "result" => result} = json_response(conn, 200)
    result
  end

  # A request of revision 2026-07-28. `headers` replaces a mirrored header; a nil value
  # removes the header.
  defp modern(conn, method, params \\ %{}, opts \\ []) do
    version = Keyword.get(opts, :version, @modern)

    meta =
      Keyword.get(opts, :meta, %{
        @version_key => version,
        @capabilities_key => %{},
        "io.modelcontextprotocol/clientInfo" => %{"name" => "test-client", "version" => "1.0.0"}
      })

    headers =
      [
        {"mcp-protocol-version", version},
        {"mcp-method", method},
        {"mcp-name", params["name"]}
      ]
      |> Map.new()
      |> Map.merge(Map.new(Keyword.get(opts, :headers, [])))

    body = %{jsonrpc: "2.0", id: 1, method: method, params: Map.put(params, "_meta", meta)}

    headers
    |> Enum.reject(fn {_name, value} -> is_nil(value) end)
    |> Enum.reduce(json_headers(conn), fn {name, value}, conn ->
      put_req_header(conn, name, value)
    end)
    |> post("/mcp", Jason.encode!(body))
  end

  # A request of a handshake-based revision. Without `version`, the client sends no
  # version header, as a client of revision 2025-03-26 does.
  defp legacy(conn, method, params, opts \\ []) do
    conn =
      case Keyword.get(opts, :version) do
        nil -> conn
        version -> put_req_header(conn, "mcp-protocol-version", version)
      end

    body = %{jsonrpc: "2.0", id: 1, method: method, params: params}
    conn |> json_headers() |> post("/mcp", Jason.encode!(body))
  end

  defp json_headers(conn) do
    conn = put_req_header(conn, "content-type", "application/json")

    if get_req_header(conn, "accept") == [],
      do: put_req_header(conn, "accept", "application/json, text/event-stream"),
      else: conn
  end
end
