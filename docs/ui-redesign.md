# Cosmic Atlas UI redesign plan

## Problem

The old right sidebar tried to own every major workflow at once: search, selected-object details, comparison, time controls, layers, zoom, status, and map actions. That made priority controls feel hidden, created repeated actions, and caused the panel to compete with the map.

The redesign treats the map as the primary surface. Persistent controls stay on the map. Task-heavy workflows open only when requested.

## Interaction ownership

| Area | Owns | Does not own |
| --- | --- | --- |
| Top status | app identity, catalog counts, loading state | search, object details, zoom, compare |
| Scale rail | zoom slider, zoom in/out, scale readout, scale presets | layers, catalog filters |
| Selection strip | current object identity, center selected, zoom selected | full object record, search results |
| Command rail | opens Search, Object, Compare, Time, Layers workspaces | duplicated workflow actions |
| Search workspace | catalog search, filters, guided sets, result list | selected-object details |
| Object workspace | selected-object scientific record | catalog browsing |
| Compare workspace | selected object as A, searched object as B, distance and size comparison | generic object search outside compare |
| Time workspace | epoch input, now, step size, back/forward | visual layers |
| Layers workspace | display toggles, size rendering mode, scale ladder | zoom slider |

## Default hierarchy

Always visible:

- Map canvas.
- Compact top status.
- Current object strip.
- Zoom/scale rail.
- Workspace command rail.

Visible only when requested:

- Search results.
- Full object details.
- Compare workspace.
- Full time controls.
- Layer settings.

## Acceptance criteria

- Zoom and scale are visible without opening a tab or workspace.
- There is one Compare entry point.
- Search results do not share a panel with object details.
- Object details do not contain catalog browsing controls.
- Selecting an object updates context but does not force the user into another workspace.
- The active workspace can be closed so the map returns to a mostly unobstructed state.
- Floating UI leaves enough viewport for the focused object and edge-reference hints.

## Visual language rules

- Workspace navigation is part of the right workspace system: right-aligned when closed, attached to the top edge of the workspace when open, and color-coded by task.
- Workspace actions must read as a primary toolbar, not a passive tab strip: large targets, strong contrast, and active color visible before the panel content.
- Zoom presets are not tabs or chips. They are a scale ruler with tick marks and physical units.
- Search filters are not suggested objects. They are catalog scopes.
- Search does not show arbitrary object shortcuts. The user searches or changes scope.
- Results are rows, not cards. Rows are for scan speed and dense catalog browsing.
- Object details can use data plates and tables because they are inspection surfaces, not navigation.
- Each workspace has one internal hierarchy: summary or primary result first, actions adjacent, detailed rows in the remaining scroll area.

## Implementation phases

1. Move current object and zoom/scale controls out of the sidebar into persistent map overlays.
2. Replace the sidebar tab strip with a compact command rail.
3. Make the workspace panel closeable and task-specific.
4. Keep existing DOM IDs and event wiring during the shell migration.
5. After the shell is stable, redesign each workspace internally.
