# TODO — Cosmic Atlas product backlog

> Updated on 2026-05-06 after the navigation UI redesign pass.

## P0 — Make navigation feel natural

- [x] Replace the datalist destination field with a rich body picker showing object icons, current Earth distance, body type, and recent/frequent destinations.
- [x] Add a click/tap body popover on the map with the primary actions: target, center, inspect, and measure from here.
- [x] Turn the journey card into the main guidance surface: show route endpoints, heading alignment, distance remaining, progress, and next recommended action without requiring the user to read multiple panels.
- [x] Add a collapsible "time travel" control so timestamp changes stay available but no longer dominate the route plotting workflow.
- [x] Add a compact tool mode switcher for pan/target/measure so map interactions have clear affordance.
- [x] Add first-run guidance that teaches the core loop in place: pick a destination, center it, fly toward it, toggle warp.

## P1 — Improve spatial understanding

- [x] Add a measurement/ruler mode for distances between any two bodies or map points.
- [x] Add inner/outer Solar System zoom presets with clear labels and icons.
- [x] Add display toggles for labels, AU rings, route lines, orbit trails, and educational overlays.
- [x] Add sampled real-ephemeris orbit trails for selected bodies, clearly labeled as time-sampled reference paths.
- [x] Add a minimap or scale strip that helps users understand where they are while zoomed in.
- [x] Add body search filters for planets, moons, dwarf planets, asteroids, spacecraft, and other catalog classes once the catalog expands.
- [x] Add viewport-side nearest-object references that update while panning and show off-screen object name, glyph, and real distance from the current map center.

## P2 — Make journeys feel rewarding

- [x] Add an arrival summary with distance traveled, closest approach, max speed, elapsed time, and target light-time.
- [x] Add optional waypoints so users can build freeform routes without relying on preset journeys.
- [x] Add route bookmarks or saved destinations after freeform navigation feels useful.
- [x] Add richer educational comparisons for selected distances: light time, Earth-Moon distances, AU, and familiar mission distances.
- [x] Add a clearer warp state: stronger ship cue, speed multiplier label, and "course correcting / drifting away" feedback.

## P3 — Make travel paths orbital

- [ ] Replace the straight Earth-destination route guide with route modes: direct reference, transfer trajectory, and gravity-assist plan.
- [x] Add launch-window exploration so users can see how departure date changes route shape, flight time, and target intercept.
- [x] Add planned trajectory previews that curve through real Solar System space instead of drawing a straight chord between bodies.
- [x] Add gravity-assist waypoint planning for flybys, with closest approach, assist body, expected speed change, and risk warnings.
- [x] Add route comparison cards for fastest, lowest-energy, and gravity-assisted travel options.
- [ ] Let the ship follow a planned trajectory as an assisted autopilot mode while keeping manual arcade flight separate.
- [x] Clearly label planned paths as approximations until the app supports full mission-grade trajectory solving.

## Future — Prepare for 3D without building it yet

- [x] Add a first outside-Solar-System catalog slice using nearby exoplanet-host stars from NASA Exoplanet Archive coordinates.
- [ ] Expand the catalog through explicit ephemeris/kernel adapters for additional moon systems, dwarf planets, asteroids, comets, spacecraft, nearby stars, and exoplanet systems without changing the destination picker contract.
- [ ] Add a catalog ingestion pipeline instead of manually curating nearby exoplanet-host star rows in source code.
- [ ] Add stellar proper motion and epoch handling for star catalog positions before treating interstellar coordinates as high-precision navigation data.
- [ ] Keep coordinate and rendering code separated so a future 3D view can reuse the same ephemeris and navigation state.
- [ ] Define a future 2D/3D view switch only when the 3D mode has a concrete user benefit beyond visual spectacle.
- [ ] Preserve all current 2D workflows when 3D is introduced: search, inspect, target, measure, route progress, and time controls.

## P0 — Deep-sky catalog MVP

> Added on 2026-05-07 for the first science/interest expansion beyond nearby stars.

- [x] Add a generated Messier deep-sky catalog snapshot with real RA/Dec, distance, magnitude, angular size, constellation, season, and NGC/IC aliases.
- [x] Load deep-sky objects through the backend catalog layer with explicit source metadata and no fake circular/orbital positions.
- [x] Keep distance-known deep-sky objects targetable in the existing 3D distance model, while clearly disabling trajectory planning for static catalog targets.

## P1 — Deep-sky discovery UX

- [x] Add destination filters for galaxies, nebulae, clusters, and deep-sky objects so users can browse beyond planets/moons/stars.
- [x] Make destination rows and inspected-body cards show useful deep-sky facts instead of physical radius placeholders.
- [x] Add visual glyphs for galaxies, nebulae, clusters, and supernova remnants in map labels, picker rows, viewport references, and journey endpoints.
- [x] Surface observability data: apparent magnitude, angular size, constellation, viewing season, and suggested observing equipment.

## P2 — Science/storytelling layer

- [x] Add guided tours for Messier highlights, nearby stars, galaxies, nebulae, clusters, and Local Group scale objects.
- [x] Add a scale ladder that explains whether the current zoom is Solar System, nearby-star, Milky Way, Local Group, or deep-sky scale.
- [x] Add light-time/lookback-time copy for interstellar and deep-sky targets so long-distance travel feels scientifically meaningful.
- [x] Update README with the new catalog sources, coordinate assumptions, visual scaling, and known accuracy limits.
