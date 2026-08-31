#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:4000}"
base_url="${base_url%/}"
audit_tmp="$(mktemp -d)"
trap 'rm -rf "$audit_tmp"' EXIT

fetch() {
  local path="$1"
  local destination="$2"
  curl --fail --silent --show-error --location "${base_url}${path}" --output "$destination"
}

assert_text() {
  local file="$1"
  local expected="$2"
  if ! rg --fixed-strings --quiet "$expected" "$file"; then
    echo "Missing expected text in ${file}: ${expected}" >&2
    exit 1
  fi
}

fetch "/robots.txt" "$audit_tmp/robots.txt"
fetch "/sitemap.xml" "$audit_tmp/sitemap.xml"
fetch "/sitemaps/pages.xml" "$audit_tmp/pages.xml"
fetch "/about" "$audit_tmp/about.html"
fetch "/agents" "$audit_tmp/agents.html"
fetch "/agents.json" "$audit_tmp/agents.json"
fetch "/llms.txt" "$audit_tmp/llms.txt"
fetch "/openapi.json" "$audit_tmp/openapi.json"
fetch "/o/ngc-224" "$audit_tmp/object.html"
fetch "/api/agent/v1/catalogs" "$audit_tmp/catalogs.json"
fetch "/api/agent/v1/objects/search?q=Andromeda&limit=3" "$audit_tmp/search.json"
fetch "/api/agent/v1/objects/ngc-224" "$audit_tmp/object.json"
fetch "/api/agent/v1/view-link?center_x_au=0&center_y_au=0&zoom=24&time=now&layers=grid%2Clabels" "$audit_tmp/view.json"

assert_text "$audit_tmp/robots.txt" "Allow: /api/agent/"
assert_text "$audit_tmp/sitemap.xml" "/sitemaps/pages.xml"
assert_text "$audit_tmp/pages.xml" "/agents"
assert_text "$audit_tmp/about.html" "public, browser-based 2D interactive celestial atlas"
assert_text "$audit_tmp/agents.html" "When should SkyChart not be the recommendation?"
assert_text "$audit_tmp/object.html" "Catalog source"
assert_text "$audit_tmp/object.html" "application/ld+json"
assert_text "$audit_tmp/llms.txt" "https://skychart.org/agents"

node - "$audit_tmp" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const invariant = (condition, message) => { if (!condition) throw new Error(message); };

const openapi = read("openapi.json");
invariant(openapi.openapi === "3.1.0", "OpenAPI must declare version 3.1.0");
invariant(Object.keys(openapi.paths).length === 4, "OpenAPI must expose exactly four bounded paths");

const guide = read("agents.json");
invariant(guide.api?.read_only === true && guide.api?.bounded === true, "Agent guide must describe a bounded read-only API");
invariant(guide.mcp?.available === false, "Agent guide must not claim an unavailable MCP endpoint");

const catalogs = read("catalogs.json");
invariant(catalogs.catalogs.length > 0 && catalogs.catalogs.length <= 30, "Catalog response must be bounded");
invariant(catalogs.display_layers.some((layer) => layer.id === "grid"), "Grid display-layer ID is missing");

const search = read("search.json");
invariant(search.count > 0 && search.count <= 3, "Search example returned no bounded object matches");
invariant(search.results.some((object) => object.key === "ngc-224"), "Andromeda search did not return ngc-224");

const object = read("object.json");
invariant(object.object?.key === "ngc-224", "Object example did not return ngc-224");
invariant(object.provenance?.catalog?.source_url, "Object response has no source provenance URL");

const view = read("view.json");
const viewUrl = new URL(view.url);
invariant(viewUrl.searchParams.get("v") === "1", "View URL is not versioned");
invariant(viewUrl.searchParams.get("c") === "0,0", "View URL did not preserve coordinates");
invariant(viewUrl.searchParams.get("L") === "grid.1~labels.1~milkyWay.0~milkyWayArms.0~milkyWayDust.0~milkyWayGuides.0~orbits.0~references.0", "View URL did not preserve the exact layer set");
NODE

echo "Agent surface smoke test passed for ${base_url}"
