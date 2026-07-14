# Whole-project Architecture Refactor

This migration preserves public behavior while making the source fit the
architecture described in [Source Architecture](source-architecture.md) and
the domain language in [`CONTEXT.md`](../CONTEXT.md).

## Completion gates

- `src/main.ts` becomes a small browser composition root.
- Catalog point streaming and catalog point selection each own their mutable
  state and source adapters.
- Destination discovery and object inspection own their complete workflows.
- The main stylesheet becomes a composition entrypoint over owned style
  modules; responsive rules live with the surface they modify.
- `backend/server.py` becomes a small executable/compatibility entrypoint over
  scientific calculation, catalog, cache, and HTTP modules.
- Phoenix catalog and import code is changed only where a deeper module or
  shared canonical rule removes real duplication.
- Offline scripts share canonical scientific and tile-format utilities where
  at least two implementations already exist.
- Tests exercise module interfaces instead of reading implementation text where
  a runtime seam exists.
- Frontend, Python, Phoenix, and browser-facing verification pass.
- No executable source above 1,000 lines remains without an explicit depth
  justification in [Source Architecture](source-architecture.md).

## Migration waves

### 1. Architecture foundation

- [x] Record domain language and invariants.
- [x] Record dependency direction and file-size guardrails.
- [x] Add automated architecture checks.

### 2. Browser runtime

- [x] Extract shared atlas contracts and configuration.
- [x] Deepen catalog point streaming.
- [x] Deepen catalog point selection.
- [x] Deepen destination discovery.
- [x] Deepen object inspection.
- [x] Isolate camera, rendering, workspace, and browser composition.

### 3. Browser styles

- [x] Split foundations, map chrome, workspace, object inspection, comparison,
      controls, sharing, diagnostics, and responsive behavior.
- [x] Keep one ordered style composition entrypoint.

### 4. Scientific backend

- [x] Separate scientific calculation from HTTP transport.
- [x] Concentrate cache freshness and metadata rules.
- [x] Separate legacy catalog lookup from dynamic calculation.
- [x] Keep `backend/server.py` as an executable and compatibility entrypoint.

### 5. Catalog and offline data

- [x] Remove duplicated source-routing rules where one canonical module can own
      them without widening its interface.
- [x] Keep deep Phoenix catalog workflows intact.
- [x] Consolidate repeated coordinate, release, and tile-format rules only when
      there are multiple real callers.

### 6. Verification and publication

- [x] Replace brittle source-text tests at the new seams.
- [x] Pass frontend unit, Python, and Phoenix build/test gates.
- [x] Pass strict maintainability review.
- [ ] Run browser suites in an environment with Playwright system libraries.
- [ ] Publish the refactor and verify the public runtime.
