# MCP directory drafts

Owner review required. Production host: __________
Guide: `<production-host>/mcp-guide` · Endpoint: `<production-host>/mcp`
Repository: https://github.com/Ferdev/skychart
Self-hosting: https://github.com/Ferdev/skychart/blob/trunk/docs/mcp-server.md

The fields above are intentionally incomplete. Confirm the application host before using a draft. From outside the server network, test initialization, tools/list and one call. A browser GET to `/mcp` must return 405. The guide returns HTML at `/mcp-guide`.

## Official MCP Registry

Title: Cosmic Atlas sky tools

Description: Search astronomical catalog records, read their sources, get geometric Solar System positions, measure object separation, and create links to Cosmic Atlas. Eleven bounded, read-only tools. Streamable HTTP, no account or key. Coverage gaps remain explicit. Positions and visibility are for orientation; this is not an authoritative archive or a bulk download service.

Example: call `get_solar_system_positions` with `{"bodies":["earth","mars"],"time":"2026-11-15T00:00:00Z"}`, then `create_object_sky_link` with `{"observer_key":"mars","look_at_key":"earth","time":"2026-11-15T00:00:00Z"}`.

Draft metadata, not a runnable publication file:

```json
{
  "$schema": "<current-official-schema-url>",
  "name": "<owner-verified-namespace>/cosmic-atlas",
  "description": "Read-only sky catalog search, geometric positions, separation and sourced atlas links.",
  "repository": {"url":"https://github.com/Ferdev/skychart","source":"github"},
  "version": "<reviewed-release-version>",
  "remotes": [{"type":"streamable-http","url":""}]
}
```

Owner steps: check the current schema, verify namespace ownership, fill the version and public HTTPS endpoint, validate the metadata, then publish through the official workflow. No publisher was run in this session. [Remote server requirements](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx).

## PulseMCP

Title: Cosmic Atlas

Description: A read-only sky server for assistants. Search the loaded catalogs, inspect provenance, check planet and spacecraft positions, measure a separation, and return an atlas or Sky link. Remote Streamable HTTP, no authentication. The service reports unavailable coverage and limits each request. Repository and self-hosting instructions are above.

Example: search `Voyager 1`, then use its returned key in an atlas link.

Status: hold. [Submissions are paused](https://www.pulsemcp.com/submit); the page directs authors to the official registry. Owner: recheck that page and retain this text for a permitted future route. Count a listing only after it is publicly visible.

## MCP.so

Title: Cosmic Atlas: read-only astronomical tools

Description: Connect an assistant to catalog search, source records, geometric positions and atlas links. Eleven bounded tools over Streamable HTTP. No account or API key. Visibility estimates exclude weather and refraction; missing data is not replaced by a zero position. Source repository and installation instructions are above.

Example: measure Earth–Mars separation at a stated UTC epoch.

Status: hold. The [submission page](https://mcp.so/submit) showed a paid route during the 15 November 2026 check. No free route was verified. No purchase is authorized. Owner: use a verified free route, or obtain separate purchase approval before proceeding.

## Smithery

Title: Cosmic Atlas sky tools

Description: A remote read-only astronomical MCP server with catalog provenance and links into a physical atlas. Search, inspect, get geometric positions, compare distances and create Sky links. Streamable HTTP without authentication. The service is bounded and does not add observations or change records.

Example: create a Sky link from Mars looking toward Earth.

Status: hold. Smithery's [service notice](https://www.smithery.ai/future) says accounts, API, CLI and proxy services ended on 31 October 2026. Its curated public registry remains. No current submission route was verified. Owner: confirm a supported route before sending this draft. Do not use old publish CLI instructions.

## awesome-mcp-servers

Draft entry:

```markdown
- [Cosmic Atlas](https://github.com/Ferdev/skychart) - Read-only astronomical catalog search, geometric positions, separation and sourced atlas links. Self-hosted Phoenix/Python server; remote Streamable HTTP also available. [Setup](https://github.com/Ferdev/skychart/blob/trunk/docs/mcp-server.md).
```

Endpoint field for any accompanying submission: __________

Owner: check the current [contribution rules](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md), confirm that the self-hosted installation meets them, and choose the required category and tags. Remote-only entries belong in their separate remote list. Test the installation before making a claim about it. No pull request or directory form was sent.

## Connection formats checked

Claude Desktop uses Customize → Connectors → Add custom connector, the endpoint URL and No sign in. It requires a public HTTPS endpoint on port 443; account and team policy can affect access. [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Cursor supports `{"mcpServers":{"skychart":{"url":"<production-host>/mcp"}}}`. [Cursor MCP](https://cursor.com/docs/mcp). Generic clients use the same endpoint with Streamable HTTP and no authentication. Recheck client instructions before publication.
