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

- [ ] Expand the catalog through explicit ephemeris/kernel adapters for additional moon systems, dwarf planets, asteroids, comets, and spacecraft without changing the destination picker contract.
- [ ] Keep coordinate and rendering code separated so a future 3D view can reuse the same ephemeris and navigation state.
- [ ] Define a future 2D/3D view switch only when the 3D mode has a concrete user benefit beyond visual spectacle.
- [ ] Preserve all current 2D workflows when 3D is introduced: search, inspect, target, measure, route progress, and time controls.
