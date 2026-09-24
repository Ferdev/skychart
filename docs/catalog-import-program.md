# Owned catalog import program

The later [focused storage investigation](catalog-storage-investigation.md)
supersedes the initial capacity discussion. The early sample extrapolations are
not measured full-catalog requirements. It records a complete measured XSC
artifact component and explicit unknowns for the remaining full scope; no new
catalog release has been admitted to production.

The release targets and deferment ledger are in
[`registry-v1.json`](../data/catalog-registry/registry-v1.json). No complete new
release is admitted yet. `partial` describes known selected source holdings, not
production coverage. `deferred` means admission prerequisites remain open; it
does not assert that the upstream product has no useful records.

The 2026-09-08 audit uses trunk revision
`390217134a9054ff8d4aaf9d23d95ca6b5c0911c`. The task container initially contained
an older shallow checkout (`c03bf9d`); the current trunk was fetched through
Rondar before development. The initial local database had the older schema;
development migrations and synthetic UI fixtures were applied after this audit.
[`local-audit-2026-09-08.json`](../data/catalog-registry/local-audit-2026-09-08.json)
records exact snapshot hashes, counts, embedded selections and a read-only local
DB count. It is not a production attestation. No imported bulk release manifests
were found in the checked-in data or public tree. Configured layer names and
scripts cannot establish bulk production counts.

Local evidence includes 33,170 selected Gaia stars and two SIMBAD slices (5,000
extragalactic and 3,947 compact objects). Hipparcos has 8,726 stars after magnitude
and positive-parallax selection. OpenNGC has 13,308 entries, of which 2,763 have
no recorded distance. The current curated file has 891 rows whereas the old local
DB has 24. This discrepancy is why file, DB, source-record, identity and rendered
LOD counts must remain distinct. Missing static distances in small-body records
are not evidence of missing dated orbit solutions.

The first release set remains SIMBAD basic+ident, complete Gaia DR3 gaia_source,
2MASS PSC/XSC and AllWISE Source Catalog. Rollout order is explicit in the
registry. SIMBAD has no verified consistent full export path in this audit;
TAP availability alone does not prove unrestricted complete export. The fallback
candidate is 2MASS XSC. IRSA documents 1,647,599 XSC records and 470,992,970 PSC
records, distributed as bulk pipe-delimited files. Its historical PSC estimate
is about 43 GB compressed and 152 GB in an unindexed Postgres table. These are
provider estimates, not measurements of SkyChart's schema. See the
[IRSA bulk README](https://irsa.ipac.caltech.edu/2MASS/download/allsky/README_ftp.html).
The [VizieR mirror metadata](https://vizier.cfa.harvard.edu/viz-bin/VizieR?-source=II/246)
independently identifies the PSC table; the main VizieR host denied automated
access during this audit. Do not bypass that restriction or page interactive
endpoints to reconstruct a bulk release.

AllWISE distinguishes its 747,634,026-row Source Catalog from the much larger
multi-epoch photometry database, rejected detections and image products. These
have separate registry entries and must not inflate object counts. See
[IRSA's product definitions](https://irsa.ipac.caltech.edu/data/WISE/docs/release/AllWISE/expsup/sec1_3.html).
The rolling backlog pins repository source targets where known; null releases
and unverified reuse/schema fields remain explicit gates, not guessed versions.
Radio components, uncertain classifications, repeats and crossmatch candidates
are not automatically independent established objects.

## Repeat the inventory

Run with the project's Python environment:

```sh
python scripts/audit_catalog_registry.py > catalog-audit.json
PGDATABASE=starsmap_api_dev PGUSER=postgres python scripts/audit_catalog_registry.py --database > catalog-db-audit.json
python -m unittest discover -s tests -p catalog_registry_test.py
```

The database option uses the caller's libpq connection, forces a read-only
session, applies connection/lock/statement timeouts and emits no credentials.
Unavailable evidence is null, not zero. Large JSON files exceed a bounded read
limit and are reported unread rather than silently sampled. The audit downloads
nothing and does not mutate data. Registry validation prevents promotion of a
selected or unreconciled release and requires hashes, reuse verification, owned
artifacts, capacity approval and a verification report. Those references must
also be independently inspected before release; validation is not approval.

## Source records and identification

The additive `catalog_record_versions` store uses the SHA-256 of the JSON array
`[provider, catalog, release, source_id]` as its record key. Each component is text;
64-bit source identifiers must never pass through a floating-point conversion.
A retry with the same namespace and different contents fails. Historical rows
cannot be updated or deleted. Existing source-specific tables, the source union
and public object keys remain compatible. This provenance contract is a
foundation, not a chosen storage layout for billions of duplicated JSON records;
C06 must benchmark a compact layout before full-volume use.

`RecordStore` preserves normalized records including original measurements,
units, uncertainties, classifications, aliases, component relationships and
source documentation. Capability flags are derived independently for metadata,
angular coordinates, evidenced spatial position and dated ephemeris models.
Missing distance never implies a coordinate at the Sun. Distinct source records
can reference the same legacy public key through published identification
provenance, and a blend can retain multiple candidate counterparts.

Identification evidence is append-only. A retraction references preceding
evidence without deleting the record or changing its public key. Published and
curated evidence are explicit; positional evidence must name its policy, epochs,
uncertainty and score. This interface does not run automatic matching. Full C07
published-crossmatch adapters and identity assembly remain separate work.

`GET /api/catalog/records/:record_key` reads source provenance from owned storage.
`GET /api/catalog/identifications/:public_key` returns up to 100 current evidence
events with an explicit `has_more` indicator. Neither calls upstream services.

## Execution gates still open

The task container had about 208 GiB free at initial audit. There is no approved
full-volume owned storage/compute envelope. Full catalog imports, production
publication and scheduled jobs have not run. All downstream release criteria
remain open until their actual tests, row reconciliation, full-volume benchmarks
and desktop/mobile full-application checks pass. A successful reference fixture
or frontend build is not evidence of full release coverage.

## Unknown positions and scientific coordinates

Snapshot validation accepts metadata without distance or coordinates. The native
API emits null physical coordinates, with independent angular/spatial capability
flags. The frontend uses its existing nonfinite-position convention internally
and disables physical centering, observer selection and comparisons without a
position. Valid coordinates at the Sun remain zero. Unknown radius remains
unknown, and unsupported diameter ratios are omitted. Reference shells never
become physical depth. Angular-only records with RA/Dec remain available to the
owned sky query and renderer without observer-parallax claims.

[`catalog_coordinate_contract.json`](../backend_phoenix/priv/catalog_coordinate_contract.json)
declares fixed J2000 mean-ecliptic axes, solar origin, units and epoch semantics.
Python, Phoenix and TypeScript share its obliquity of 23.4392911 degrees. This is
an atlas projection: it does not model ICRS frame bias, apparent astrometry or
perspective acceleration. Proper motion uses a normalized tangent vector;
missing motion retains the source direction and epoch. Gaia bulk positions are
at source epoch 2016; snapshot propagation explicitly records its display epoch.
Positive, sufficiently significant parallax is a physical-placement policy, not
a condition for retaining a source record. Staging defaults to SNR 5; existing
Gaia detail uses its separately documented SNR 3 placement threshold. Original
parallaxes, errors and policy thresholds remain available. Cosmological distance
models remain labelled, and comoving comparisons omit Euclidean light time.

New ephemeris cache keys include the frame contract. Old cached Gaia detail is
labelled with its legacy frame rather than silently recomputed. Existing SMP3
and SMPK1 artifacts are not rewritten; an artifact built without new frame
metadata retains the explicit legacy label. Full release-aware rendering and
release migration remain C12/C13 gates: publish rebuilt coordinates only under
a distinct release with consistent metadata and retained predecessors.

## Bounded local staging and recovery

The new staging command consumes already acquired files; it does not issue
archive queries, start scheduled jobs or publish a catalog. Reuse the existing
Gaia downloader and provider bulk downloads for acquisition. A complete release
requires the provider's complete file inventory and reconciled counts, verified
terms and the approved capacity envelope before any full-volume run.

Pin the provider, catalog, release, documentation, schema (types and units),
normalization mapping, upstream row counts and SHA-256 for every input file.
Store official checksums and acquisition provenance in the registry alongside
the locally computed SHA-256. Preserve a source's scientific schema; only map
fields to astrometry when the declared units and frame match. Unsupported source
normalizations need an adapter and independent reference fixtures before use.

[`catalog-staging-manifest.example.json`](catalog-staging-manifest.example.json)
describes four synthetic rows, not a public catalog sample or release. Exercise
interruption and resume locally:

```sh
python scripts/stage_catalog_release.py estimate --manifest docs/catalog-staging-manifest.example.json --source-root tests/fixtures
python scripts/stage_catalog_release.py stage --manifest docs/catalog-staging-manifest.example.json --source-root tests/fixtures --stage-root data/catalog-staging-fixture --max-records 1
python scripts/stage_catalog_release.py stage --manifest docs/catalog-staging-manifest.example.json --source-root tests/fixtures --stage-root data/catalog-staging-fixture
```

The returned `release_id` identifies a directory under the stage root. Verify it
with `verify --release data/catalog-staging-fixture/<release_id>`. The fixture
reconciles four fetched rows to three accepted records and one quarantined
duplicate. One record has a usable parallax estimate; two have unknown distance.
No identities are established, and coverage remains `unadmitted`.

Readers support scalar CSV/ECSV/delimited data, CDS fixed-width fields, FITS
table batches (the existing optional `fitsio` dependency), and VOTable TABLEDATA.
Gzip text is streamed. Decompress FITS into budgeted scratch storage first.
VOTable binary encodings, multiple tables and unsupported schemas fail explicitly.
ECSV metadata is retained in the owned input; the manifest must separately pin
its schema. Add tests before extending accepted formats or scientific mappings.

The command defaults to 100,000 processed rows per invocation, batches of 500,
an 8 MiB SQLite cache and a 1 GiB compressed-source budget. `--max-records` pauses
at a transactional checkpoint. `--max-source-bytes` must include all pinned
files; it is not an estimate of decompressed/normalized storage. Stop/cancel and
rerun the same manifest to resume; gzip resumes by scanning to a logical row
checkpoint. Source files are retained once, measurements once per record, and
schemas/units once per manifest. SQLite is a local staging index, not a selected
billion-row serving solution. Disk-full errors cannot activate a release.

Source/schema changes, truncated input and count mismatches prevent sealing.
Verification checks owned-file hashes, the database hash, SQLite integrity and
row accounting. Quarantine reasons and file/row provenance remain locally
queryable. A sealed staging release can update the local pointer using
`activate --release <directory> --stage-root <owned-root>`; the release must be
inside that root. This atomically preserves unrelated catalog pointers. Roll
back by activating a previous verified directory. Retention is keep-all for
these development artifacts; there is no automatic deletion. This pointer is
not connected to production catalog admission, serving indexes or deployment.

## Capacity evidence and remaining delivery

Run the repeatable local probe after development migrations:

```sh
PGDATABASE=starsmap_api_dev PGUSER=postgres python scripts/benchmark_catalog_capacity.py data/catalogs/gaia_local_stars.json --scales 1000,10000
```

The probe refuses remote connection settings and writes only temporary tables in a rolled
back transaction. It reports table/index bytes, COPY throughput and warm exact
lookup latency. Its synthetic IDs and repeated selected rows are explicitly not
full-catalog validation.

[`local-capacity-probe-2026-09-08.json`](../data/catalog-registry/local-capacity-probe-2026-09-08.json)
measured 14,393,344 total bytes for 10,000 Gaia snapshot rows (about 1,439 bytes
per row), including 2,195,456 index bytes. COPY processed about 21,500 rows/second;
warm in-process exact lookup p95 was 0.011 ms. These measurements exclude network
latency and the full scientific schema. They suggest multi-terabyte storage for
the initial release set, but cannot establish a capacity or cost commitment.
The container has 768 MiB RAM and 0.5 CPU, with about 208 GiB free disk at audit.

On 2026-09-09 the user selected the existing staging server as the destination
for full catalog imports. This settles the destination choice; its available
capacity has not been measured. The staging app is configured at
`staging.skychart.org`, while the SSH host/user and staging database connection
are supplied through deployment secrets in CI. This task session has neither
SSH credentials/agent nor a configured Rondar deployment target. The public
application URL does not establish SSH access or database location.

Run the read-only report on that server through the existing administrative
connection, adding any intended catalog storage directory:

```sh
python3 scripts/catalog_host_capacity.py / /path/to/catalog-storage
```

Alternatively, from a checkout containing the script, send it over the existing
SSH connection without installing or deploying it on the server:

```sh
ssh <existing-host-alias> python3 - < scripts/catalog_host_capacity.py
```

The script reads CPU, memory, cgroup limits, filesystem headroom and Docker's
storage directory if accessible. It does not import, deploy, inspect secrets or
alter the server. Its JSON output can be supplied without credentials. Running
it in this task container only describes the task container. Do not sum paths
that share a filesystem, or treat free space as reserved capacity. Review actual
database placement before writes: the existing workflows use an externally
configured staging database, and its isolation from production is not verified.

C01–C05 have foundation code and fixture verification here; unresolved source
metadata/access and full source-specific normalization still require admission
audits. C06 remains open: representative source populations, alias/text/angular
indexes, cross-identification, full-volume coexistence, tile builds, server and
browser budgets, refresh costs and an approved owned staging environment are
not measured. C07–C14 are pending in their original order. No complete SIMBAD,
Gaia, 2MASS or AllWISE release has been imported or admitted, and this branch is
not a complete implementation of the saved plan.

## Verification of this foundation

On 2026-09-08, the full Python suite passed 157 tests plus four subtests with no
skips, including the offline bulk-release composition test after installing
`scripts/gaia_bulk_requirements.txt`. The existing upload guard test requires its
mock AWS CLI to take precedence; the locally installed virtualenv AWS executable
was temporarily made non-executable for that run and restored afterwards. No
upload was performed. Phoenix passed 123 tests against local Postgres, including
null coordinates, known distance without direction, immutable evidence,
lossless identifiers and legacy Gaia cache frames. Compilation passed with
warnings treated as errors.

Both frontend builds, tour validation, view state, sky projection/appearance,
constellations, helper, decoder, manifest, stream, object mapper and small-body
checks passed. The build reports the existing large main-bundle warning; a full
catalog browser capacity budget is still unmeasured.

`node tests/catalog-unknown.browser.mjs` passed at 1440×1000 and 390×844 against
running Phoenix and Python services. It verified an owned angular-only record,
real ephemeris availability, old shared-link inspection, disabled unsupported
physical controls, and native Earth-sky loading without endpoint mocks or
service-unavailable skips. Seed an angular-only snapshot record into the local
development database using the existing importer before rerunning, and set
`CATALOG_UNKNOWN_KEY` to its public key; `ATLAS_BASE_URL` selects the local app.
The task used a synthetic `ngc-unknown` nebula at RA 90°, Dec 0°, without distance.
These are focused foundation checks, not C14 full-release or full-site browser
acceptance. The development servers were stopped afterwards.

## Apps Server capacity measured after SSH rotation

The 2026-09-09 SSH retry succeeded. The read-only report and targeted container
configuration inspection are recorded in
[`apps-server-capacity-2026-09-09.json`](../data/catalog-registry/apps-server-capacity-2026-09-09.json).
The server has 8 logical CPUs, 62.6 GiB RAM (55.7 GiB available when measured),
and about 243 GiB free on its root filesystem. Docker uses that same filesystem;
these are not separate pools of free space. No additional catalog volume was
found in the filesystem report. The SkyChart containers have no explicit Docker
memory/CPU limits configured.

Both SkyChart staging and production run on this host. Critically, both web
containers point to the same `skychart` database on `skychart-production-postgres`.
Thus an import into the currently configured staging database is a production
mutation. The server-selection decision does not authorize such writes. No
imports, database writes, deployment or resource allocations were performed.
The earlier SSH-access blocker is resolved; database isolation and a measured
capacity envelope remain necessary before full-volume execution. The initial
JSON/Postgres prototype's multi-terabyte extrapolation does not fit the observed
free disk, and a full-volume storage architecture has not yet been selected.
