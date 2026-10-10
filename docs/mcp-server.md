# Public MCP server

Cosmic Atlas publishes a public [Model Context Protocol](https://modelcontextprotocol.io/)
server at `https://skychart.org/mcp`. An assistant that connects to it can search
the atlas, read object records with provenance, find where Solar System bodies and
spacecraft are, measure the separation of two objects, estimate visibility from a
place on Earth, and build validated atlas and Sky links.

The server needs no account or key. All tools are read-only and bounded.

## Connect a client

The endpoint is `https://skychart.org/mcp` with the Streamable HTTP transport and
no authentication. For example:

```sh
claude mcp add --transport http skychart https://skychart.org/mcp
```

Clients that read a JSON configuration use an entry of this shape:

```json
{ "mcpServers": { "skychart": { "type": "http", "url": "https://skychart.org/mcp" } } }
```

A local server (`mix phx.server`) serves the same endpoint at
`http://localhost:4000/mcp`. The Vite development server proxies `/mcp` to Phoenix.

## Tools

| Tool | Domain operation | Bound |
| --- | --- | --- |
| `search_sky_objects` | `AgentInterface.search/1` | Query of 3–80 characters; 1–10 results. |
| `get_sky_object` | `AgentInterface.object/1` | One public object record; 180-byte key. |
| `list_sky_catalogs` | `AgentInterface.catalogs/0` | The maintained catalog and display-layer list. |
| `create_sky_view_link` | `AgentInterface.view_link/1` | A validated object or two finite map-plane coordinates, and documented layers. |
| `create_object_sky_link` | `AgentSky.sky_link/1` | One observer with a 3D atlas position; optional target; validated camera, filters, and locale. |
| `get_solar_system_positions` | `AgentSky.positions/1` | At most 24 bodies, of which at most 4 spacecraft; years 1850–2149. |
| `measure_object_separation` | `AgentSky.separation/1` | Two objects with a 3D atlas position. |
| `get_object_visibility` | `AgentSky.visibility/1` | One modeled object and one place; the current time only. |
| `list_sky_events` | `AgentSky.events/1` | 1–50 stored events. |
| `list_guided_tours` | `AgentSky.tours/0` | The published tours. |

The first four tools are the operations of the REST agent API (`/api/agent/v1`,
see `/openapi.json`). They take the same parameter names and return the same
payloads, except that `layers` is an array in MCP. A contract test compares the
two transports, so they cannot disagree.

Each tool result has the payload as JSON text and as `structuredContent`. An
invalid argument, an unknown object, or an unavailable scientific service is a tool
result with `isError: true` and an `error` object (`code`, `message`,
`parameter`), so that a model can correct the call. An unknown tool name is a
JSON-RPC error.

Each tool description states that the atlas is for orientation, source discovery,
and shareable links, and that it is not an authoritative archive, a bulk data
service, or an observing planner. Positions, separations, and visibility are
geometric values; the results carry a `limitation` text and the upstream source.

## Protocol

- Transport: Streamable HTTP. One JSON-RPC message for each `POST /mcp`, and one
  `application/json` response. The server opens no event streams, so `GET` and
  `DELETE` get `405`.
- State: none. The server sets no `Mcp-Session-Id` and no cookie.
- Revision `2026-07-28` (per-request metadata): `server/discover`, `tools/list`,
  and `tools/call`. The server validates `MCP-Protocol-Version`, `Mcp-Method`, and
  `Mcp-Name` against the body (`HeaderMismatch`, `-32020`), the request metadata
  (`-32602`), and the version (`UnsupportedProtocolVersion`, `-32022`). Results
  carry `resultType`, the server identity, and the cache hints `ttlMs` and
  `cacheScope`. An unknown method gets `404` with `-32601`.
- Revisions `2025-11-25`, `2025-06-18`, and `2025-03-26` (handshake): `initialize`,
  `notifications/initialized`, `ping`, `tools/list`, and `tools/call`. The handshake
  negotiates only the version, so the server needs no session for these clients.
- Capabilities: `tools` only. The server offers no resources, prompts, sampling,
  elicitation, subscriptions, tasks, or write operations.

There is no official MCP SDK for Elixir; community libraries exist (for example
`anubis_mcp`). The surface here is a stateless, tools-only server, so
`StarsmapApi.Mcp` implements the protocol in one small module without a new
dependency and without session processes. The official conformance suite and the
official TypeScript SDK client verify it (see below). If the server must later offer
streams, subscriptions, or authorization, examine a maintained library again.

## Security and limits

- Read-only tools over public data; no cookies, no credentials, no dynamic code.
- `Origin`: a request with an `Origin` header that is not the site origin gets
  `403`. Browsers on other sites cannot use the endpoint. MCP clients that are not
  browsers send no `Origin` header.
- Body: `Content-Type` must be `application/json`; at most 64 KiB
  (`StarsmapApiWeb.Plugs.McpBody`). Batches are refused.
- Rate limit: 120 requests each minute for each client address, in a budget that
  is separate from the JSON API (`StarsmapApiWeb.Plugs.RateLimit`, scope `:mcp`).
  A client above the budget gets `429`. Hosted assistants can share an egress
  address; adjust the capacity in the router if their traffic needs it.
- The scientific service calls have a 20-second timeout. A tool that raises is
  logged with its name and the exception. The request log has no tool arguments,
  because the MCP body is not parsed into request parameters.

## Code map

| Module | Responsibility |
| --- | --- |
| `StarsmapApi.Mcp` | JSON-RPC and protocol rules for both protocol eras. |
| `StarsmapApi.Mcp.Tools` | Tool names, descriptions, input schemas, and dispatch. |
| `StarsmapApi.AgentInterface` | Search, object, catalog, and view-link operations (shared with REST). |
| `StarsmapApi.AgentSky` | Positions, separations, Sky links, visibility, events, and tours. |
| `StarsmapApi.AgentSky.Observation` | Access to `/api/observe` of the scientific service. |
| `StarsmapApiWeb.McpController` | HTTP rules: method, `Origin`, content negotiation, status codes. |
| `StarsmapApiWeb.Plugs.McpBody` | Bounded raw body, read before the general parsers. |

## Verification

Automated tests (`mix test`):

- `test/starsmap_api_web/controllers/mcp_controller_test.exs`: transport rules,
  both protocol eras, header and metadata validation, each tool, and the
  REST/MCP contract.
- `test/starsmap_api/agent_sky_test.exs`: the sky operations and their bounds.

Checks against a running server (`mix phx.server` with the scientific service):

```sh
npx @modelcontextprotocol/conformance@0.2.0-alpha.12 server \
  --url http://localhost:4000/mcp --scenario <scenario> --spec-version <revision>
scripts/audit_agent_surfaces.sh http://localhost:4000
```

Results on 2026-10-10 with conformance `0.2.0-alpha.12`:

| Scenario | Revision | Result |
| --- | --- | --- |
| `http-header-validation` | 2026-07-28 | 14 of 14 checks pass. |
| `tools-list` | 2026-07-28 and 2025-11-25 | All checks pass, including the wire schema. |
| `dns-rebinding-protection` | 2026-07-28 and 2025-11-25 | Both checks pass. |
| `server-initialize`, `ping` | 2025-11-25 | All checks pass. |
| `server-stateless` | 2026-07-28 | All checks pass, except four checks that need the diagnostic tools of the reference server (`test_missing_capability`, `test_streaming_elicitation`, `test_logging_tool`). The subscription checks are skipped because the server declares no subscriptions. |
| `caching` | 2026-07-28 | The `tools/list` hints pass. The checks for `prompts/list` and `resources/*` do not apply; the server does not offer those features. |

The other scenarios call tools, prompts, or resources that exist only in the
reference server, and do not apply.

The official TypeScript SDK client (`@modelcontextprotocol/sdk` 1.32.1,
`StreamableHTTPClientTransport`) connected, negotiated `2025-11-25`, listed the
tools, and called them, including a tool error and an unknown tool.

After a deployment, run `scripts/audit_agent_surfaces.sh https://skychart.org`. The
script checks discovery, the tool list, and one tool call on the real endpoint.

Protocol references, read on 2026-10-10:

- [Streamable HTTP transport, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
