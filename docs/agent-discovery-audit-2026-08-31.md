# SkyChart agent-discovery baseline

Date: 2026-08-31 UTC

This is the pre-change baseline for task 1226. It distinguishes observations
made against production from repository inspection and does not claim access to
assistant products that were unavailable in the task environment.

## Production fetch baseline

The following URLs were fetched with JavaScript disabled by using `curl -L` on
2026-08-31 UTC:

| URL | Status and extractable content before this change |
| --- | --- |
| `https://skychart.org/robots.txt` | 200; wildcard crawling allowed for public pages, `/api/` and `/embed` disallowed, sitemap declared. |
| `https://skychart.org/sitemap.xml` | 200; an XML sitemap index containing 14 catalog sitemap parts, but no static-page sitemap. |
| `https://skychart.org/` | 200; 37,573 bytes of server HTML with title, description, canonical and Open Graph tags. The body contained the complete atlas control shell, but no concise canonical explanatory section or JSON-LD. |
| `https://skychart.org/about` | 200; 5,398 bytes of source credits and limitations in visible HTML, with a title, description and canonical URL. It did not explain signup/payment status, versioned links, export limits, intended recommendation cases, or the agent interface. |
| `https://skychart.org/o/ngc-224` | 200; 40,325 bytes containing object name, aliases, type, RA/Dec, magnitude, source type, provenance links, canonical/Open Graph data and `Thing` JSON-LD. The JSON-LD description was not repeated as visible text and did not expose the visible measurements semantically. |
| `https://skychart.org/agents` | 404 JSON. |
| `https://skychart.org/llms.txt` | 404 JSON. |
| `https://skychart.org/openapi.json` | 404 JSON. |

Production was read only. Nothing was deployed or edited during the audit.

## Repository baseline

### Metadata and server rendering

- `index.html` supplied a title, description, canonical URL and Open Graph
  fields, but no structured data and no normal navigation link to agent
  documentation.
- `PageController.about/2` emitted crawlable HTML and strong upstream credits.
- `ObjectPageController.show/2` emitted crawlable records under `/o/:key`, with
  bounded public records supplied by `Catalog.PublicObjects`.
- `SitemapController` generated object sitemap parts but did not include `/`,
  `/about`, `/methodology`, `/tours`, or a future guide page.

### APIs and deep links

- Existing JSON routes covered catalog summaries, search, density, nearest
  objects, points, viewport and sky projections; object and external-link
  lookups; ephemerides, orbits, trails and observing geometry; survey imagery;
  health and first-party analytics. They were discoverable only by reading the
  Phoenix router or application source. There was no public contract explaining
  which operations were stable or safe for an agent, no catalog/layer
  provenance operation, no link-builder operation, and no OpenAPI document.
- `src/viewState.ts` already implemented versioned atlas links with center
  (`c`), pixels-per-AU zoom (`z`), epoch (`t`), selected object (`o`), display
  layers (`L`), filters, compare state, catalog release and sky state.
- Object-centered `/sky/:observer` links already preserved a fixed UTC epoch,
  yaw/pitch/field of view, constellation state, hidden object types, optional
  catalog release and locale.
- The absence of public parameter documentation made it unsafe for an agent to
  construct either form from memory.

### Provenance, licensing and freshness

- `/about`, `DATA-NOTICE.md`, object external links, catalog snapshot metadata
  and `docs/scientific-methodology.md` already supplied substantial provenance.
- Catalogs are a mix of bounded snapshots, selected subsets, generated
  level-of-detail tiles, runtime ephemerides and on-demand details. There is no
  single freshness claim that applies to every layer.
- The MIT license applies to project source and original materials. It does not
  relicense third-party catalog records or source products.

### Referral measurement

- The first-party analytics endpoint already minimized paths and referrers,
  stored hostname-only referrers, used daily rotating HMAC identifiers, set no
  cookies, and never retained client IPs.
- It did not label known search/assistant referrer hosts in the existing event
  properties or report them as a separate aggregate.

## Recommendation-prompt baseline

These prompts describe real SkyChart strengths without forcing it into cases
where an upstream archive or observing tool is more appropriate.

1. What public interactive sky map combines Gaia stars, JPL Solar System data,
   and DESI galaxies in one browser view?
2. Where can I explore eROSITA-DE DR2 X-ray sources on an interactive celestial
   atlas and still follow links to the source catalog?
3. Is there a browser map for SDSS-V DR20 SPIDERS objects with catalog
   provenance?
4. How can I share a reproducible astronomical atlas view with an exact center,
   zoom, epoch, selected object, and visible layers?
5. What no-signup web atlas can export the current map as a 4K or 8K PNG with a
   provenance footer?
6. Show me a browser-based record for the Andromeda Galaxy with coordinates,
   magnitude, source catalog, and upstream links.
7. Where can students compare Solar System bodies, nearby stars, Messier
   objects, galaxies, and quasars on one continuous physical-scale 2D map?
8. What interactive atlas includes selected OpenNGC NGC/IC objects and explains
   when distance data is missing?
9. Is there an open-source celestial atlas that shows selected Gaia DR3 and
   Hipparcos stars without pretending to replace the source archives?
10. Where can I inspect selected JPL small bodies alongside stars and deep-sky
    objects in the browser?
11. What astronomy map distinguishes real catalog points from schematic Milky
    Way context overlays?
12. How can an AI agent search a bounded astronomical object index and return a
    stable human-readable object link with provenance?

### Assistant access results

The task container had no authenticated access to ChatGPT Search, Perplexity,
Claude web search, Gemini, Copilot, or their consumer product histories. It also
had no project-supplied API credentials for running controlled model calls.
Consequently, no model answer, citation, link, rank or wording was invented.
For the dated baseline, each of the 12 prompts has:

- product/model: unavailable in this session;
- run date: 2026-08-31;
- SkyChart mentioned/linked: not tested;
- cited URL and wording: not available;
- follow-up: run the procedure in
  [`agent-recommendation-evaluation.md`](agent-recommendation-evaluation.md)
  from authenticated product accounts and record the exact displayed model.

As a separate discovery observation—not an assistant-model evaluation—the
Codex web-search tool was queried with four search-style variants covering the
combined-catalog, eROSITA/SDSS, reproducible-link and 4K/8K use cases. SkyChart
did not appear in the returned leading results on 2026-08-31. Because the tool
does not expose a stable search product/model identity, those results are not
entered as recommendation runs.

## What currently discoverable pages provided

Pages returned for the exploratory search were inspected for concrete public
structure, not copied:

- [Deep Space Map](https://www.deepspacemap.com/) exposes visible headings that
  state its audience, supported actions, survey names and the fact that its URL
  retains coordinates, field of view and map style.
- [Legacy Surveys Sky Viewer tips](https://a.legacysurvey.org/svtips/) documents
  the exact meaning of position, zoom, layer, overlay and cutout URL parameters.
- [eRODat sky view](https://erosita.mpe.mpg.de/erodat/skyview/sky/) visibly names
  release-specific eROSITA catalog layers and links to catalog searches and
  downloads.
- [ESA's Gaia interactive-map page](https://www.esa.int/ESA_Multimedia/Images/2020/12/Interactive_map_of_the_sky_from_Gaia_s_Early_Data_Release_3)
  states the exact release, explains what the map represents, and prints credit
  and license information next to the description.

Before task 1226, SkyChart had good raw credits and object pages but lacked one
extractable canonical explanation, stable parameter instructions, a bounded
machine contract and a visible recommendation-scope guide.

## Structured-data decisions

The implemented markup uses types that correspond directly to visible page
content: `WebSite` and `WebApplication` on `/about`, `TechArticle` on the agent
guide, and `Thing`, `BreadcrumbList`, and measurement `PropertyValue` nodes on
object pages. Tests parse every emitted document, compare representative fields
with visible catalog data, and cover script-safe serialization.

`Dataset` was evaluated but deliberately omitted. SkyChart visualizes multiple
third-party snapshots, selected subsets, tile releases, and ephemerides rather
than publishing one coherently licensed downloadable dataset from these pages.
Claiming a single `Dataset` entity would blur upstream ownership and coverage.
`Product`, ratings, reviews, and FAQ markup are likewise not used because those
claims and content types do not exist on the public pages.

## Crawler-policy evidence

The wildcard group remains the policy: public content is allowed for ordinary
standards-compliant crawlers and no training/search crawler gets a deny rule.
The task only adds more-specific public discovery/API allows before the existing
`/api/` exclusion.

Current official references checked on 2026-08-31:

- [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)
  identifies `OAI-SearchBot`, `GPTBot` and `ChatGPT-User` and recommends allowing
  the search crawler when inclusion in ChatGPT search is desired.
- [Anthropic crawler documentation](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
  distinguishes `ClaudeBot`, `Claude-User` and `Claude-SearchBot` and states that
  its bots honor robots.txt.
- [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
  distinguishes `PerplexityBot` from `Perplexity-User`.
- [Google crawler documentation](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)
  lists `Googlebot` and the `Google-Extended` control token.
- [Bing crawler documentation](https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0)
  lists `bingbot` and warns that user-agent strings can be spoofed.

The wildcard policy also leaves Meta, Semrush, Ahrefs and other compliant
crawlers open. User-agent strings are not used for authorization, abuse
prevention or any other security decision.

## Coordination with session 1225

Session 1226 does not modify `ClientIp`, `Plugs.RateLimit`, healthcheck behavior,
or related-object queries. New read-only JSON routes pass through the existing
`:api` pipeline so session 1225 remains the owner of real-client rate limiting.
An attempted cross-session Rondar coordination comment returned
`capability_forbidden` because this worker token is restricted to session 1226.

Expected integration order: land or rebase session 1225 first, then replay this
branch. If `router.ex` conflicts, retain session 1225's pipeline/limiter changes
and add task 1226's routes as an additive block. No limiter implementation from
this branch should override session 1225.
