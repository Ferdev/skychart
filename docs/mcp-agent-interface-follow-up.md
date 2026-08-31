# Public MCP follow-up design

Status: design only; no MCP endpoint is shipped by task 1226.

## Decision

The project currently has Phoenix and JSON dependencies but no maintained MCP
server dependency. The latest MCP specification at the task date is
`2026-07-28`, which removed the older `initialize` / `initialized` handshake and
protocol-level sessions in favor of a stateless core. It also requires
`Mcp-Method` and, for tool calls, `Mcp-Name` HTTP headers that agree with the
JSON-RPC body.

Implementing an older initialize-only subset to satisfy a historical smoke
sequence would therefore be a toy protocol, not a current standards-compliant
Streamable HTTP server. Implementing both current and legacy protocol versions
without an SDK would add disproportionate parser, negotiation, transport,
origin-validation and conformance risk. It would also overlap session 1225's
real-client rate-limit work. Task 1226 ships the shared bounded domain
operations and OpenAPI surface instead.

Primary protocol references checked 2026-08-31:

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [HTTP header standardization SEP-2243](https://modelcontextprotocol.io/seps/2243-http-standardization)
- [MCP tools schema](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

## Proposed endpoint

- Path: `POST /mcp`; optional current-spec discovery through
  `server/discover` as defined by the selected SDK/spec version.
- Protocol: current MCP Streamable HTTP / JSON-RPC, not a home-grown partial
  emulation.
- Deployment: inside Phoenix only if a maintained Elixir SDK passes the
  protocol conformance suite; otherwise a small maintained Tier-1 SDK adapter
  may call the Phoenix domain module over an internal interface. It must not
  duplicate search, provenance or link-building business logic.
- Security: public read-only tools; strict JSON content type and body limit;
  Origin validation; header/body agreement checks; no cookies; no dynamic code,
  resources, prompts, sampling, elicitation, tasks or write operations.
- Reliability: route through the real-client limiter finalized by session 1225;
  apply a tighter capacity for MCP calls; emit bounded structured logs without
  prompt text or IP retention.

## Tool mapping

All tools call `StarsmapApi.AgentInterface`, which is already used by the REST
API:

| Tool | Domain operation | Bound |
| --- | --- | --- |
| `search_sky_objects` | `AgentInterface.search/1` | Query 3–80 characters; 1–10 results. |
| `get_sky_object` | `AgentInterface.object/1` | One public semantic object; 180-byte key. |
| `list_sky_catalogs` | `AgentInterface.catalogs/0` | Maintained finite catalog and layer list. |
| `create_sky_view_link` | `AgentInterface.view_link/1` | Validated object or two finite map-plane coordinates and documented layers. |

Each tool description must repeat that SkyChart is appropriate for atlas
orientation, source discovery and shareable visualization, not for bulk data,
calibrated images, observing plans or authoritative scientific measurements.
Tool errors should be returned as structured tool results so a model can
self-correct; malformed protocol methods remain JSON-RPC errors.

## Required smoke and conformance evidence

Before exposing `/mcp`:

1. Pin the MCP SDK and protocol revision.
2. Pass the official conformance suite for the chosen revision.
3. Exercise current discovery (if used), `tools/list`, and every successful and
   bounded-error `tools/call` over real HTTP, with required MCP headers.
4. If legacy clients are intentionally supported, separately test the exact
   older initialize/initialized/session sequence under its declared protocol
   revision; do not label it current-spec behavior.
5. Verify Origin rejection, body limits, header/body mismatch rejection,
   method/content negotiation, per-real-client rate limiting, and the absence of
   write tools.
6. Run the same domain-contract tests against REST and MCP results so the two
   transports cannot drift.

The public `/agents` page must continue to say that MCP is unavailable until all
of those checks pass on preview/staging with a real client.
