# TODO - Cosmic Atlas Scientific Browser Roadmap

> Updated on 2026-05-13 after the science-only UI, Phoenix catalog, WebGL point-layer, workspace redesign, and object-media pipeline passes.

## Product Direction

Cosmic Atlas should become useful as a scientific object browser, not just an impressive map. The next version should make celestial objects easier to find, understand, compare, and trust at catalog scale. Sharing/story-mode work is intentionally out of scope for this milestone.

## P0 - Smoke And Performance Guardrails

- [x] Add automated browser smoke tests for catalog search, selected-object detail, compare search, filter application, curated media, and survey media.
- [ ] Make the point-layer hydration smoke test deterministic enough to run unskipped in CI/local automation.
- [x] Add a lightweight performance regression test that asserts idle rendering stops and zooming does not issue runaway `/api/catalog/points` or `/api/catalog/viewport` requests.
- [x] Document the local verification command set for Phoenix-served UI changes, including `npm run build`, `npm run build:phoenix`, browser smoke tests, performance tests, and Phoenix tests.

## P0 - Object Pages

- [x] Split selected-object detail into clearer sections: Overview, Position, Motion/Orbit, Stellar/Deep-sky/Small-body facts, Media, Source links, and Related objects.
- [x] Show aliases, external IDs, and external lookup links as first-class provenance instead of hidden metadata.
- [x] Add object-detail empty and catalog-preview states so object selection no longer feels like a repurposed search screen.
- [ ] Add explicit async loading/error states when object detail hydration becomes server-driven instead of local selection-driven.
- [x] Add related-object blocks for parent body, moons/children, nearby visible objects, and same-catalog neighbors.

## P1 - Search And Discovery

- [ ] Add keyboard navigation for catalog and compare result lists.
- [ ] Add loading and empty states for long catalog searches and point-tile fetches.
- [ ] Add broad-search pagination or a "load more" affordance for result lists that have more matches.
- [ ] Preserve the selected object while filters change, even when the selection is outside the active filter.
- [ ] Add dedicated Explore views for Solar System, Nearby stars, Messier, Galaxies, Exoplanet systems, and Small bodies.
- [ ] Keep filtered map visibility and filtered result lists fully aligned.

## P1 - Catalog Scale And Data Architecture

- [ ] Replace the shared `catalog_objects` table with source-specific tables before scaling Gaia beyond single-digit millions.
- [x] Add source-specific import row counts and validation reports for each catalog import.
- [ ] Persist import reports and add chunk-level progress for very large Gaia-style imports.
- [ ] Add proper-motion and epoch propagation for stellar catalogs before advertising high-precision star positions.
- [ ] Add a full NGC/IC catalog path instead of relying on Messier aliases.
- [ ] Add more Solar System satellites and comet subsets through explicit source adapters.
- [ ] Keep Rust limited to measured catalog-plumbing hotspots such as high-volume ingestion, offline point-tile building, or binary encoding if profiling proves it is needed.

## P1 - Object Media And Scientific Context

- [x] Add a curated object media manifest for the first high-value planets and deep-sky objects.
- [x] Show curated media inside selected-object detail with title, credit, license, and source link.
- [x] Expand curated NASA/JPL planet media coverage.
- [x] Expand curated Messier media coverage for M31, M42, M45, and M57.
- [x] Add a survey-cutout fallback for RA/Dec objects using a stable sky-survey service when no curated image exists.
- [ ] Expand curated major-moon media coverage.
- [ ] Add curated media for M13 and other common clusters that are not covered well by NASA Image Library searches.
- [ ] Add coordinate readouts for RA/Dec, Galactic coordinates, and ecliptic position when source data exists.
- [ ] Add short "why this object matters" summaries for curated objects and high-value catalog categories.

## P2 - Map Performance And Rendering Quality

- [x] Render large catalog point layers with WebGL instead of canvas loops.
- [x] Cache WebGL body point buffers when visible body identities do not change.
- [x] Build hit-test grids lazily instead of rebuilding them on every render frame.
- [x] Limit concurrent point-tile fetches to avoid UI stalls during zoom and pan.
- [ ] Move heavy point-tile decoding into a Web Worker if binary decode time remains visible.
- [ ] Add level-of-detail rules that keep point density readable at Milky Way scale.
- [ ] Add tile cancellation and prioritization based on the newest camera position.
- [ ] Profile and simplify the Milky Way overlay so it does not dominate frame time at wide zooms.
- [ ] Keep a diagnostics mode that reports frame cost, active tile count, and request pressure without affecting normal users.

## P2 - Milky Way And Large-Scale Context

- [x] Show an oriented Milky Way context layer in the same top-down ecliptic projection as the map.
- [x] Remove fake selectable-looking stars from the Milky Way overlay; real catalog stars come from Gaia point layers.
- [ ] Improve the Milky Way model with scientifically labeled components and clearer projection caveats.
- [ ] Add toggles for Galactic center, arms, disk, dust, and reference rings only when they help scientific reading.
- [ ] Add a mode that explains the difference between local Gaia stars, Milky Way context, and extragalactic objects.

## P3 - Future 3D And Advanced Science

- [ ] Keep coordinate, catalog, and rendering code separated so a future 3D mode can reuse the scientific model.
- [ ] Define a future 2D/3D switch only when it adds concrete scientific value, not visual spectacle.
- [ ] Preserve search, object detail, compare, time controls, and source provenance if 3D is introduced.
- [ ] Investigate mission-grade trajectory solving separately from this scientific atlas branch.

## Parking Lot - Game Branch

- Ship controls, warp state, route progress, gravity-assist gameplay, autopilot, and journey rewards belong in the separate game branch, not in this science-first atlas.
