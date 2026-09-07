# Spacecraft catalog

Spacecraft use the existing search, selection, date controls, comparisons and
object panel. No mission layer toggle, preset, Explore card, tab or trajectory
controls are added. Markers are symbolic diamonds, with existing hit targets and
label collision rules. Ordinary markers disappear beyond a 0.03 light-year view;
a selected craft remains visible. Dimensions are unknown, never guessed.

## Inventory and review

The September 6, 2026 audit of the Horizons Support spacecraft inventory contains
250 provider records: **97 admitted spacecraft and 153 exclusions**. The exact
included/excluded inventories and reasons live in
`backend_phoenix/priv/spacecraft.json`. Vehicles have stable `spacecraft-{abs(SPK ID)}`
keys. Multiple vehicles in a mission (the Voyagers, MarCO, GRAIL, etc.) remain
separate. Alternate solutions, rocket stages, unflown designs, unreviewed surface
missions, obsolete test trajectories and most Earth-satellite records needing a
separate freshness review are excluded. This is a Horizons catalog, not a claim
to include every mission ever launched. For example, Gaia needs the separate
Earth-satellite trajectory review before admission.

Names, aliases, TDB coverage envelopes, source revision, retrieval date and a hash
of each Horizons metadata response are recorded. Launch dates are extracted only
from explicit launch fields; reviewed overrides and brief descriptions live in
`scripts/data/spacecraft_metadata.json`. Missing metadata stays unknown. Source
links open the full provider notes, including the solution's reconstruction and
prediction history. Metadata prose is supplied in its source language; UI labels
are translated into all nine supported languages.

Rebuild and review before committing:

```sh
.venv/bin/python scripts/audit_spacecraft.py --cache /tmp/spacecraft-audit
.venv/bin/python -m unittest tests.spacecraft_test
node --experimental-strip-types tests/spacecraft.test.ts
npm run build
```

Requests are serial and resumable. Remove a cached metadata file when reviewing
an updated trajectory; remove the entire cache for a fresh metadata audit. Review
new mission identities, explicit launch fields, termination dates, provider
warnings and changes in coverage. Envelopes are not continuous coverage claims:
Horizons checks internal gaps at each requested epoch. Landing/impact cutoffs are
explicit UTC constraints where the provider extends a trajectory past the event.
Do not infer a launch date from the start of trajectory coverage.

## Positions and loading

`GET /api/spacecraft?timestamp=...&key=spacecraft-31` returns all admitted metadata
and currently available positions. `key` optionally prioritizes a selected craft.
The normal planetary ephemeris does not wait for this endpoint or its jobs.
A single background worker serializes spacecraft Horizons calls, with a 256-job
queue, deduplication, selected-object priority and a ten-second network timeout.
Transient network failures trigger a one-minute provider backoff. The browser
polls one catalog request every two seconds while work remains; it retries
unavailable records after a minute and stops old requests on date changes.

Successful positions have a 24-hour disk TTL; both vector and payload cache keys
include source revision and epoch/frame information. The in-memory result cache
is bounded. Failures are held briefly, never stored as valid positions. A cold
catalog can take a minute or more to fill in, depending on the number of eligible
missions and provider latency; planets and metadata remain usable throughout.

Horizons supplies geometric Sun-centered ICRF vectors in KM-S at UTC epochs.
Skyfield rotates them into the existing true ecliptic/equinox-of-date frame.
All three axes remain available for distances. Earth separation uses Earth at the
same epoch. Distance divided by c is an **estimated one-way light time**, not a
live communications reading or an iterated signal light-time solution. Mission
termination, activity and contact status are not inferred from a trajectory.

Wire positions are null when loading, outside coverage, or temporarily
unavailable. The frontend adapts them to non-finite numeric sentinels required by
its existing Body contract; explicit guards exclude them from markers, centering,
Sky observers and distance comparisons. No last-known position is retained across
time changes. Historical objects remain searchable and shared URLs restore their
identity even when no position exists. Spacecraft apparent brightness and local
rise/set predictions are not modeled.

The existing Phoenix public-object/search paths expose the same manifest without
a database import. Explicit spacecraft keys are also supported by the Python
ephemeris path for server-owned Sky share resolution. Ordinary bulk star tiles
remain independent of this small dynamic catalog. The runtime image copies the
shared manifest into the Python backend’s expected path as well as the Phoenix
release’s priv resources.

## Verification

Fixture tests cover identities/aliases, metadata parsing, coverage endpoints,
termination, null positions, gaps/outages, finite vectors, simultaneous 3D
distance, bounded nonblocking catalog requests, translations and stale-response
suppression. Browser tests exercise Voyager search and shared-link restoration,
Cassini's historical availability, date changes, disabled centering, and desktop
and mobile layouts. Live validation sampled Voyager 1, Juno, JWST, New Horizons
on September 6, 2026, and Cassini on January 1, 2010; each returned valid vectors.
The full catalog returned 53 eligible and 44 out-of-coverage records at the
September epoch: 3.8 seconds including cold Skyfield initialization, and 6 ms
for a repeated metadata request while the position queue was active.

Primary references: [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html),
[time spans](https://ssd.jpl.nasa.gov/horizons/time_spans.html),
[API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), and
[NASA's Voyager light-day milestone](https://science.nasa.gov/mission/voyager/voyager-1/voyager-1-what-is-a-light-day/).
