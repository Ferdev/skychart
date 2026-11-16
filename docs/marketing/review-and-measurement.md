# Review and measurement

This implements saved plan 144, revision 1, from source commit `b7c276e95863102ef3a5b47acf51d078241813e0`. The earlier Sentinel evidence was `ef0585efad6d320bfb1d679728336f0bb456bff8`. Plans 24 and 5 were read for shared scope; their source and plan state were not changed.

The work follows the saved order: common routes and measurement, MCP, combined spacecraft pages, tonight, target snapshots, then the survey flight. All six ideas are represented. The survey prerequisites passed, so that flight was built. There are no new scientific models or feature switches.

## Review paths

- `/mcp-guide`: eleven read-only tools, current connection instructions and four example calls. `/mcp` keeps its transport behavior.
- `/spacecraft` and its five detail pages: one shared loader, manifest identities, epoch, distances, speeds and explicit gaps.
- `/tonight`: the existing prediction and translated transit facts. The date selects mid-transits in a UTC day. At most three adjacent local solar nights are calculated, because a UTC day crosses local-night boundaries. Duplicate events are removed before rendering.
- `/targets`: the existing matcher, candidate choice, source CSV and map layer. Sharing is explicit. `/targets/r/:token` restores the saved facts without rematching them. A separate availability check can label records missing from the current catalog.
- `/tours/sun-to-survey-field`: Sun → Andromeda → 3C 273. The player uses source chips, a survey image and the current loaded-point state.

Sky is the existing geometric view from Earth. A site's coordinates set the night and altitude calculations; they do not create a new local-horizon renderer. This source limit is stated beside Open in Sky. Record transit uses the existing sign-in callback, which retains the selected event and night. No timing was sent to an external archive.

## Shared result storage

Apply migration `20261116000000_create_target_snapshots` during the separately approved release. It uses the existing application database, without community accounts. No production migration was run here.

A match returns a signed receipt valid for one hour. Saving verifies that receipt and any chosen candidate's receipt. A candidate must belong to the original ambiguous row. The server stores only a reduced, immutable result, its creation time, the source snapshot fields when supplied, source digests and a result digest. Source links permit HTTP or HTTPS only. The receipt is not an account credential.

Limits: 500 rows, 512,000 bytes of serialized rows per result, 100,000,000 serialized bytes across results, and 10,000 results. Creation shares the existing 12-request catalog budget. An advisory transaction lock makes concurrent quota checks atomic. At capacity, creation returns `share_storage_full`; matching and CSV remain available. Saved links do not expire. There is no list gallery.

A local four-row fixture used 1,365 serialized bytes before the added source snapshot fields, 1,639 bytes for its JSONB column, and one newly allocated table plus index used 32 KiB. These are small-fixture measurements, not production capacity estimates. Before release, check representative 500-row results, `sum(bytes)`, `pg_column_size(payload)` and `pg_total_relation_size('target_snapshots')`. The serialized quota excludes index, WAL and table overhead; reserve database space for these. Do not raise the limit without capacity review.

Application request logs suppress shared result paths. Database operations on saved rows suppress their parameters. Phoenix filters receipts and selections. Shared pages use noindex and no-referrer, and tokens are removed before atlas error reporting starts. Error reporting also removes matching request breadcrumbs. Before public release, verify that reverse-proxy access logs and any infrastructure outside this repository redact `/targets/r/*` and `/api/catalog/target-snapshots/*`. That external logging configuration was not accessible in this session.

## Measurement definitions

No new analytics service was added. Browser actions use `/api/events`; the server stores the existing daily anonymous client estimate. The same person can have multiple estimates, and people on one network can share an estimate. Do not call these exact people or sessions.

| Experiment | Window from actual release | Exposures and actions |
| --- | --- | --- |
| MCP | Weekly | Owner counts publicly visible listings out of five. Report holds separately. Count successful initializations and successful calls by tool. Count atlas/Sky opens with `source=mcp`. |
| Voyager 1 | Weekly | Page views and `cross_tool` atlas opens from its path. |
| Fleet | 14 days | Page views, atlas opens, and positioned/gap totals from one completed snapshot per requested epoch. Loading renders and polls do not count again. |
| Tonight | 30 days | `calculation_completed` for successful UTC-day calculations, plus Sky and Record transit starts. Count daily client estimates with those actions; compare with daily estimates that completed a calculation. |
| Target lists | 14 days | Match completions, explicit share creations, sourced CSV/clipboard exports, and source hosts. The storage counter records one later-day open per snapshot per UTC day, not a person's return. |
| Survey flight | 14 days | `tour_started`, `tour_completed`, referrals, and `source_open` with `last_stop` or `cutout`. Automatic image loads are not opens. |

New event names are `calculation_completed`, `source_open` and `mcp_request`. The only added property keys are bounded counts `positioned` and `gaps`. Existing bounded `source`, `tool`, `method`, `tour` and `format` keys identify actions. Shared paths normalize to `/targets/r/:result` on both client and server. Input lists, sites, result tokens and query strings are excluded from event payloads.

The MCP server is stateless. Initializations, calls and daily client estimates are separate counts. A source marker is added only to the two MCP view-link operations. Links through object pages, clients that remove markers, lost referrers and non-browser clients can cause undercounting. Public clients can make or omit markers; they do not prove attribution.

Open a page with `?measurement=owner-test` before a manual check to exclude browser events for that tab's session storage. Snapshot reads propagate the same exclusion header. MCP health checks use `X-Atlas-Measurement: owner-test`. Browser automation is excluded by the existing `navigator.webdriver` check. Other probes and tests cannot be identified reliably; report that limit. Snapshot later-day counts can include unmarked bots or probes.

Example read-only queries (set a real release timestamp):

```sql
SELECT event_name, path, properties->>'source' AS source,
       properties->>'tool' AS tool, count(*) AS actions,
       count(DISTINCT (inserted_at::date, anonymous_id)) AS daily_client_estimates
FROM analytics_events
WHERE inserted_at >= TIMESTAMPTZ 'YYYY-MM-DD 00:00:00+00'
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;

SELECT properties->>'method' AS method, properties->>'tool' AS tool, count(*)
FROM analytics_events
WHERE event_name = 'mcp_request' AND inserted_at >= TIMESTAMPTZ 'YYYY-MM-DD 00:00:00+00'
GROUP BY 1,2;

SELECT count(*) AS shared_results, sum(later_day_opens) AS later_snapshot_days,
       sum(bytes) AS serialized_bytes, avg(pg_column_size(payload)) AS average_jsonb_bytes
FROM target_snapshots;
```

For the transit rate, join daily anonymous identifiers that completed a calculation to those that opened Sky or Record transit on the same UTC date and path. Divide those distinct daily estimates, not repeated button clicks. Show the action counts beside that rate. A zero denominator has no rate.

Keep an owner log with page, release date, destination, post URL, post date, referral host, and visible/paused/paid/unverified status. Record links people send you; do not scrape forums. No growth target is set before a baseline exists. No traffic means distribution has not been tested.

## Owner release checklist

1. Review the code, migration, measurement limits and five draft documents. Release requires separate approval.
2. Confirm the public host and test MCP from outside the server network. Fill the blank directory fields. PulseMCP is paused, MCP.so has no verified free route, and Smithery has no verified submission route after its service closure.
3. Compare a spacecraft row with Horizons at identical epoch, centers, frame, units and geometric settings. Set tolerances first and record the comparison. Compare one transit with a trusted prediction at the same site/date.
4. Check the public catalog records, source chips, DR11 field/fallback and actual DESI point state. Record whether the draft sentence required correction.
5. Check external log redaction and result-storage capacity. Check the current community rules and the real moderator handoff.
6. Review every draft before posting or sending it. Record publication URLs and dates. Start each measurement window at release.

No accounts, directory submissions, forum posts, writer messages, purchases, deployment or merge were performed.

## Verification completed in this session

- Phoenix: 104 focused tests passed, including MCP transport, guide examples, page/sitemap contracts, spacecraft, target matching, signed snapshots, quotas, analytics and community transit review.
- TypeScript: 35 focused tests passed for spacecraft loading, night planning, transit processing, target CSV/layers, tour controls and catalog streaming. All three tour files passed validation.
- Python: 47 spacecraft, night-planner and transit-timing tests passed.
- Browser: eight focused tests passed against the production asset build. They cover phone width and keyboard access, spacecraft values/gaps/epochs, login context, UTC-day selection, stale responses, site-free links/events, fresh-browser snapshot/CSV/map restoration and the three-stop tour with reduced motion and an AllWISE fallback.
- The agent-surface audit passed against the local Phoenix server. Its old four-path check was corrected to include the existing read-only calendar path.
- Both `npm run build` and `npm run build:phoenix` passed. The existing large shared-bundle warning remains. Lockfiles did not change.
- A browser calculation reached the real event endpoint. The database row stored `calculation_completed`, `/tonight`, `source=tonight`, and `tool=transits`, without a site or target key.

The container needed its locked Node and Elixir dependencies restored and the Python test runner installed. No tracked toolchain or dependency versions changed. Local databases and scientific-service fixtures were used for tests. The complete suite remains for CI. A real community email, FITS upload, directory submission or external timing submission was not used as a test.

The owner still needs the live Horizons/transit comparisons, public host check, external log-redaction check, current posting-rule checks, and release approval. This session did not measure post-release traffic or publish a draft.
