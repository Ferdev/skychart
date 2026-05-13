# TODO - Cosmic Atlas Science Roadmap

> Updated on 2026-05-13 after the science-only UI, Phoenix catalog, WebGL point-layer, and workspace redesign passes.

## P0 - Stabilize The Scientific Atlas

- [x] Split the old ship/game prototype away from this branch and keep this app focused on scientific exploration.
- [x] Make Phoenix the browser-facing catalog service for search, object detail, viewport loading, and point layers.
- [x] Keep Python as the scientific ephemeris and ingestion worker behind Phoenix.
- [x] Move the UI to a map-first shell with persistent scale controls and a task workspace.
- [x] Replace separate Compare picker behavior with the same catalog search model used by the Search workspace.
- [x] Render large catalog point layers with WebGL instead of canvas loops.
- [x] Throttle viewport and point-tile work so zooming does not trigger excessive parallel backend requests.
- [ ] Add automated smoke tests for catalog search, compare search, object selection, and point-layer tile loading.
- [ ] Add a lightweight performance test that asserts idle rendering stops and zooming does not issue runaway tile requests.

## P1 - Catalog Scale And Data Architecture

- [x] Import generated Hipparcos bright stars, Gaia local stars, Gaia bulk slices, JPL small bodies, NASA Exoplanet Archive systems, Messier objects, and SIMBAD extragalactic objects.
- [x] Add paginated and tiled Gaia loading without increasing startup payload.
- [x] Add real point primitives for bulk Gaia stars with hover/click hydration.
- [x] Keep rendered catalog points visually consistent across sources instead of using catalogue-specific marker styles.
- [ ] Replace the shared `catalog_objects` table with source-specific tables before scaling Gaia beyond single-digit millions.
- [ ] Add source-specific import progress, row counts, and validation reports for each catalog.
- [ ] Add proper-motion and epoch propagation for stellar catalogs before advertising high-precision star positions.
- [ ] Add a full NGC/IC catalog path instead of relying on Messier aliases.
- [ ] Add more Solar System satellites and comet subsets through explicit source adapters.

## P1 - Object Detail And Provenance

- [x] Add a curated object media manifest for the first high-value planets and deep-sky objects.
- [x] Show curated media inside selected-object detail with title, credit, license, and source link.
- [x] Expand curated NASA/JPL planet media coverage.
- [x] Expand curated Messier media coverage for M31, M42, M45, and M57.
- [x] Add a survey-cutout fallback for RA/Dec objects using a stable sky-survey service when no curated image exists.
- [ ] Expand curated major-moon media coverage.
- [ ] Add curated media for M13 and other common clusters that are not covered well by NASA Image Library searches.
- [ ] Split object detail into clearer sections: Overview, Position, Motion/Orbit, Stellar/Deep-sky/Small-body facts, Media, and Source links.
- [ ] Show aliases and external lookup links as first-class provenance, not hidden metadata.

## P1 - Search, Filtering, And Selection

- [x] Make Search and Compare use the same query, scope-filter, ranking, and result-row primitives.
- [x] Apply active filters to map visibility as well as result lists.
- [ ] Extract catalog search state and rendering into a dedicated frontend module.
- [ ] Add loading and empty states for long catalog searches and point-tile fetches.
- [ ] Add keyboard navigation for result lists.
- [ ] Add pagination or "load more" affordances for broad searches that return many matches.
- [ ] Preserve the selected object while changing filters, even when it is outside the active filter.

## P2 - Map Performance And Rendering Quality

- [x] Cache WebGL body point buffers when visible body identities do not change.
- [x] Build hit-test grids lazily instead of rebuilding them on every render frame.
- [x] Limit concurrent point-tile fetches to avoid UI stalls during zoom and pan.
- [ ] Move heavy point-tile decoding into a Web Worker if binary decode time remains visible.
- [ ] Add level-of-detail rules that keep point density readable at Milky Way scale.
- [ ] Add tile cancellation and prioritization based on the newest camera position.
- [ ] Profile and simplify the Milky Way overlay so it does not dominate frame time at wide zooms.
- [ ] Add a diagnostics mode that reports frame cost, active tile count, and request pressure without affecting normal users.

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
