# Source Architecture

Cosmic Atlas is organized around deep modules: each public interface hides a
complete domain workflow, and its implementation owns the state, ordering,
failure modes, and verification rules for that workflow.

## Runtime shape

```text
Browser composition root
  -> atlas view and interaction modules
  -> catalog point streaming
       -> decode worker adapter
       -> main-thread decode adapter
       -> WebGL renderer
  -> catalog point selection
       -> Gaia adapter
       -> DESI adapter
       -> Quaia adapter
  -> destination discovery
       -> remote catalog adapter
       -> browser storage adapter
  -> object inspection

Phoenix public application
  -> catalog semantic index
  -> analytics and current-event modules
  -> Python transport adapter

Python transport adapter
  -> scientific calculation
       -> Skyfield/SPICE implementation
       -> JPL Horizons implementation
       -> scientific cache

Offline catalog tools
  -> source normalization and validation
  -> catalog import
  -> immutable point-layer build and audit
```

JPL Solar-System objects deliberately stay outside the immutable point-layer
path. They are small enough for the bounded viewport-object API, which keeps
their precise coordinates and stable selectable identities. SMP3 remains the
bulk visualization path for survey-scale catalogs.

## Module rules

1. The composition root wires modules together and starts the application. It
   does not contain rendering, search, scientific, or transport implementation.
2. Mutable state belongs to the module whose behavior depends on it. Unrelated
   modules do not coordinate by editing shared global variables.
3. The interface is the test surface. Source-text assertions are reserved for
   release wiring that cannot be exercised through a runtime interface.
4. A seam exists only when behavior actually varies. Two decode adapters and
   three catalog-source adapters justify their seams; a single implementation
   does not need a speculative abstraction.
5. Source-specific catalog rules remain with their adapter. Shared projection,
   validation, and reporting remain in catalog import.
6. Phoenix catalog lookup, public-object assembly, point queries, snapshots,
   search, and import row mapping are separate deep modules. New catalog rules
   belong to the narrowest owning module rather than a catch-all namespace.
7. Translation dictionaries and generated scientific data are data modules,
   not orchestration. Their line count is not an architecture metric.

## Dependency direction

- Domain contracts depend on no browser or transport implementation.
- Browser modules may depend on domain contracts and focused rendering helpers.
- Transport adapters depend on domain modules; domain modules do not depend on
  HTTP request objects.
- Offline tools may emit runtime formats; runtime modules never import offline
  builders.
- Tests cross the same interface as production callers whenever possible.

## File-size guardrail

One thousand lines is a review trigger for executable source. A file above that
threshold needs a documented reason based on module depth, not convenience.
Composition roots and transport adapters should stay far below the threshold.
Large declarative data modules are reviewed for navigability rather than split
mechanically.
