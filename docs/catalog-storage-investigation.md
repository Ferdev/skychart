# SkyChart storage investigation

The focused investigation is complete. A complete XSC detail-and-lookup component
was measured at 1.453 GB; the exact total for the full requested catalog scope
remains unknown. No additional infrastructure spending, production writes or
deployment occurred. Measured artifacts, provider-reported metadata and remaining
unknowns are separated below.

## Definition of done, recorded before investigation code

Scope remains complete Gaia DR3 gaia_source, SIMBAD basic plus identifiers when
a consistent complete export can be verified, 2MASS PSC/XSC, and AllWISE Source
Catalog. The broader registry remains unchanged. Selected snapshots and smaller
catalog alternatives are labelled separately and do not satisfy full scope.

Required behavior: exact source-ID and alias lookup, bounded name/text search,
angular cone and applicable physical lookup, independently retrievable owned
source detail, stable existing keys/links, and bounded native rendering/LOD.
Unknown coordinates/distances and ambiguous identity evidence survive. Numeric
compression cannot silently lower astrometric precision or lose source IDs.
All original scientific fields must be retained or reversibly reconstructible
under a pinned schema. Search-only projections are not full source records.

Investigation query targets (proposed, not measured product SLAs): warm local
exact-ID/detail p95 <=100 ms; prefix and 1-degree cone queries returning at most
100 rows p95 <=250 ms. Query timings must distinguish database/library time from
HTTP, network and browser time. No error/timeout becomes an empty successful
result. Full query semantics, cold-cache behavior, concurrency and full-size
rendering remain unverified unless actually measured. Preserve existing app data.

Deliver a standalone report with reproducible measurements of row/schema/index
overhead, compact alternatives, final experimental artifacts and allocated bytes,
observed build-space high-water marks, checksums/counts, rollback options and
missing measurements. Exactness means a specified immutable source release and
versioned complete serving/detail/index schema, fully constructed and reconciled.
The earlier 4.4/8.8 TB numbers are unvalidated sample extrapolations, not measured
requirements. Neither a sample nor partition sums prove unbuilt global indexes.

## Resource and safety envelope

No purchase/provisioning, paid storage, deployments, full production imports,
production mutations or deletion of existing resources. One agent only.
Apps Server inspection is read-only; staging and production share a database.
Experiments use an investigation-owned directory and isolated scratch database
in the existing task container, not that shared database.

At the start of this investigation the task filesystem had 234,224,852,992 bytes
available. Choose a 4 GiB aggregate scratch cap and a 200 GiB free-space floor;
this reserves the remaining headroom for existing workloads instead of assigning
all free disk to the investigation. Use one worker, <=256 MiB database/Arrow
working memory where configurable, and the task's existing 768 MiB/0.5 CPU
container ceiling. Check disk before each phase and monitor scratch high water.
These are chosen investigation limits, not measured production headroom needs.
Time-box an individual exploratory build to 10 minutes; stop and report excessive
duration or contention before any whole-release run. Only investigation-owned
scratch may be recycled. No full release will start until its transfer/build
feasibility has been checked within this envelope.

After serial 5,000-row XSC measurements, permit a single complete XSC candidate
trial capped at 20 minutes of processing (same space/memory limits). The measured
pilot built in 1.742 seconds before queries; extrapolating its throughput suggests
about 574 seconds for 1,647,599 rows, but this is a feasibility estimate, not a
measured runtime. The two official gzip files have HTTP sizes 369,484,277 and
443,941,833 bytes. Their download is bounded at those sizes, one at a time. The
candidate stores all 389 columns, with no additional float32 quantization, plus
an ID/designation/angle lookup. Source verification counts and integer sums must
agree with IRSA before calling the artifact set complete for this candidate.
Allocate at most 3.5 GiB to files and 512 MiB to the isolated local Postgres
database within the 4 GiB aggregate cap. This is an investigation-only trial.

## Results

Measurements, provider metadata and unknowns are recorded separately below.
The original import plan remains incomplete.

## Storage responsibilities and rollback design

Keep narrow lookup/routing fields (release-scoped ID, aliases/name search,
position capabilities, row-group locator) separate from the full scientific
record. The experiment retains all fields in typed Parquet, using dictionary
compression for repeated text and float64 for source float values. Source-schema,
units, namespace and release provenance can be recorded once per release instead
of repeated in each JSON row. This is a candidate split, not an implemented
replacement for SkyChart's production Postgres/Phoenix routes.

Preserve original downloaded releases according to an explicit retention policy.
A format conversion can preserve scientific values without preserving original
whitespace or compressed source bytes. Dropping the originals would trade away
byte-for-byte source reproduction and must not be silently assumed in sizing.
The measurements therefore list source downloads separately from normalized
artifacts. Decompression streams into bounded batches; no whole uncompressed
CSV copy is required for the tested XSC path.

Two complete, independently indexed copies are not intrinsically required for
rollback. Immutable content-addressed partitions and retained manifests can share
unchanged files. A changed partition requires its predecessor plus its replacement
until retention permits retirement. The current experimental single SQLite index
would still need a second version when its routing changes. Per-partition lookup
indexes can share unchanged versions, but require an independently measured global
ID/alias routing structure. Published identity/evidence history also has its own
retention cost. A wholly rewritten catalog may approach two full versions; the
actual overlap/change rate is unknown. No exact rollback budget follows from the
current sample, and no existing artifacts have been deleted.

A bounded draw layer is separate from full availability: selection and detail
must resolve records omitted from rendering LOD. This investigation does not
replace the native renderer, create complete angular tiles, or measure the cost
of arbitrary full-catalog text search, physical indexes or cross-identification.
Those omissions remain explicit components of the full required storage total.

## Prototype audit findings

The provenance prototype has five text identity columns plus JSONB. The 64-digit
hex record key occupies 65 bytes per sampled value, before its index. Provider,
catalog and release repeat both in columns and the JSON wrapper. Original Gaia
IDs/names/aliases also occur in the source measurements; astrometry repeats some
of those measurements in the normalized wrapper. The two B-tree indexes provide
hash-key and namespace uniqueness, not complete text/alias/sky search.

Using exactly 33,170 existing local snapshot records in an isolated database:

| Layout | Heap bytes | Index bytes | Total relation bytes |
|---|---:|---:|---:|
| Provenance wrapper plus original measurements | 54,591,488 | 7,200,768 | 61,833,216 |
| Original measurement JSON plus provenance columns | 38,805,504 | 7,200,768 | 46,047,232 |
| Original measurement JSON, release namespace once, ID index only | 34,078,720 | 1,376,256 | 35,463,168 |

Totals also include PostgreSQL auxiliary storage. For the first layout the mean
stored tuple was 1,581.94 bytes and its JSONB value 1,442.55 bytes. PostgreSQL
reported 151,256,087 bytes for the entire isolated experiment database after the
runs; a filesystem stat measured 151,273,472 allocated bytes. This includes all
three alternatives and database overhead, not a single serving layout.

The live source-specific Gaia table separately has 38 columns and 13 indexes.
Its measured relation size is 304,308,224 bytes. A bounded first-100-row inspection
found mean tuple size 3,094 bytes and source-payload size 749.88 bytes. These are
not a representative full-table payload distribution or an exact reclaimable-
space estimate. No VACUUM, index removal or production mutation was performed.

The existing Gaia downloader retains nine columns. A bounded header read from
`GaiaSource_000000-003111.csv.gz` found 152 source columns; the downloaded official
MD5 manifest lists 3,386 source files. The local snapshot's 22 fields include
SkyChart-derived values and are not the complete Gaia schema. The 4.4/8.8 TB
extrapolations therefore cannot answer the full-record storage question.

## Measured complete XSC artifact component

Both complete official XSC gzip files were processed in the isolated task
workspace. The candidate `xsc-all-columns-f64-v1` retains all 389 columns and all
1,647,599 source records, including flags for duplicates and excluded-use cases.
It makes no claim that those records are distinct physical identities. There
are 101 independently readable Parquet partitions. This is a complete measured
**detail-and-lookup component**, not an admitted native SkyChart release.

| Component | Logical file bytes | Allocated filesystem bytes |
|---|---:|---:|
| All 101 Parquet detail partitions | 1,200,092,947 | 1,200,300,032 |
| Complete SQLite ID/designation/angular lookup | 252,555,264 | 252,559,360 |
| Detail plus lookup | **1,452,648,211** | **1,452,859,392** |
| Retained original gzip downloads | **813,426,110** | Listed separately in evidence |

Thus the measured data/index component is about **1.453 GB**, and retaining its
source downloads brings those components to **2.266 GB**. These totals exclude
small measurement/progress reports and do not include unbuilt cross-catalog
identities, native rendering artifacts, production integration or backups.
No existing source records were deleted and no database on Apps Server was changed.

The full build took 708.25 seconds (11.80 minutes) in the 0.5-CPU task container;
index construction took 2.96 seconds. Max process RSS was 117,572 KiB. The observed
100-ms-sampled high-water mark across investigation files plus this process's
open/unlinked temporary files was 2,524,004,352 allocated bytes. That included
source downloads and other investigation fixtures. It excludes the separate
151,273,472 allocated bytes in the isolated Postgres database. The largest observed
open/unlinked temporary-file total was 39,527,319 bytes. Monitoring started during
the build, so this is an observed lower bound, **not an exact instantaneous peak**.
The batch/phase cap checks and filesystem free-space floor remained satisfied.

IRSA's complete-release checks matched exactly:

| Check | Result |
|---|---:|
| Rows | 1,647,599 |
| Sum of ext_key | 2,146,404,951,676 |
| Sum of use_src | 1,587,504 |
| Sum of dup_src | 196,537 |
| Sum of pts_key | 992,540,387,061,069 |

Verification independently rescanned every gzip source row in 23.82 seconds,
verified every partition hash and row count, checked SQLite integrity and lookup
counts, and compared all 389 fields for five source records spread across the ID
range. Network access was disabled in the query process. Warm local detail p95
was 67.94–95.62 ms across those probes, designation-prefix p95 0.049–0.098 ms,
and one-degree cone p95 0.217–0.577 ms. Query samples are small, caches were warm,
and neither HTTP/browser overhead nor concurrent load was measured. The queries
met the proposed investigation targets; this is not a production SLA result.

Primary source: [IRSA release verification queries](https://irsa.ipac.caltech.edu/2MASS/download/allsky/verification_query_xsc.txt).
The gzip files' SHA-256 values, each partition's size/hash, row accounting and
source schema are retained in the machine-readable evidence.

## Measured Gaia snapshot component

The complete **selected local snapshot**, not full Gaia DR3, round-tripped all
33,170 records and all 22 original fields through typed Parquet. A presence bitmap
preserves absent fields separately from explicit nulls. Original numeric IDs and
floating-point values survive without extra quantization. Detail files occupy
5,786,221 bytes; detail plus SQLite lookup/aliases/angular indexes occupy
19,569,261 logical bytes (19,599,360 allocated bytes). This is materially smaller
than the tested JSON layouts, but does not establish full-Gaia storage.

After correcting unnecessary full-row-group conversion and ensuring the angular
index is traversed before row hydration, serial warm local probes measured detail
p95 0.989–2.042 ms, alias/prefix p95 below 0.03 ms and cone p95 below 0.04 ms.
These do not implement or measure the current app's ranked substring search,
group/type filtering, pagination semantics, full identity assembly or rendering.
Early runs exposed a missing-versus-null preservation failure and inefficient
query/decode paths; the final measurement was repeated serially after corrections.
Intermediate simultaneous experiments are not used as the final latency evidence.

## Provider-reported AllWISE inventory and measured alternatives

IRSA already publishes the complete AllWISE Source Catalog as Parquet, with
298 columns and 12,288 files. A bounded anonymous object inventory reconciled
exactly with its row-count manifest: **747,634,026 reported rows** and
**364,543,757,806 reported logical data-file bytes**. Including the provider's
metadata sidecars gives 365,125,943,157 bytes. These are exact sums of the returned
provider metadata, **not locally downloaded/verified catalog bytes**, and not a
SkyChart storage requirement. The source README's rounded “340 GB” must not be
mixed with this report's explicit decimal-byte and binary-GiB units.

Copying that published encoding unchanged would exceed the Apps Server's measured
260,970,049,536 free bytes, before any SkyChart indexes, other catalogs or reserved
headroom. This does not prove that every lossless layout or every arrangement on
existing resources is impossible.

Three source partitions were selected by minimum, median and maximum row count
(36,400; 58,508; 90,989 rows), downloaded and verified against provider MD5 sums.
All schemas, null masks and values were checked after conversion. Their combined
original size is 96,906,035 bytes. They do not constitute a statistical compression
model of the entire catalog.

| Encoding actually tested on those files | Candidate bytes | Largest warm detail p95 | Max RSS |
|---|---:|---:|---:|
| Zstd-3, 4,096-row groups | 110,737,699 | 67.94 ms | 316,328 KiB |
| Zstd-3, original large row groups | 83,729,433 | 823.45 ms | 716,104 KiB |
| Zstd-3, 4,096-row groups, float byte-stream split | 188,632,171 | 67.29 ms | 339,240 KiB |

The smaller row groups improve bounded detail reads but increased size in these
files. Preserving large groups reduced size, while exceeding the proposed detail
latency target and approaching the task's hard memory limit. The float encoding
experiment was worse for size. None establishes that full AllWISE will fit.
No full AllWISE conversion was launched; scaling a configuration that already
fails the resource/query target would not establish the desired final design.

Primary sources: [IRSA Parquet release description](https://irsa.ipac.caltech.edu/data/download/parquet/wise/allwise/healpix_k5/README.md),
[per-file row counts](https://irsa.ipac.caltech.edu/data/download/parquet/wise/allwise/healpix_k5/wise-allwise-row-counts-per-file.csv),
and [source checksums](https://irsa.ipac.caltech.edu/data/download/parquet/wise/allwise/healpix_k5/wise-allwise-md5sums.txt).

## Exactness, remaining measurements and fit decision

**The exact complete SkyChart storage requirement is still unknown.** The
investigation establishes a complete XSC component and several bounded alternatives,
not a total for the requested catalog scope. The earlier 4.4/8.8 TB estimates
must not be used as infrastructure requirements.

| Component needed for full scope | Evidence now | Smallest missing measurement |
|---|---|---|
| XSC source details and ID/designation/angular lookup | Complete artifacts measured and reconciled | Native serving/rendering integration and its additional artifacts |
| Gaia DR3 full scientific source records | Source header/manifest; selected 22-field snapshot measured | Pin and build a complete 152-field candidate, then process every source partition |
| 2MASS PSC | Official release format and historical provider figures | Build/measure its complete typed detail and lookup artifacts; historical Postgres estimates are not current measurements |
| AllWISE | Complete provider metadata inventory; three verified-file experiments | Choose a layout meeting storage/query constraints, then construct every partition and the full routing/search indexes |
| SIMBAD basic plus identifiers | Consistent complete acquisition path still unverified | Obtain a pinned consistent export/schema before exact artifact construction |
| Aliases, identity/crossmatch evidence, global routing | Not fully built | Build their complete release-specific structures; partition sums do not size these |
| Native angular/physical LOD layers and API behavior | Existing code, no full-release measurements | Construct required layers and benchmark full lookup versus drawn subsets |
| Refresh/rollback/backups | Sharing design described, no full refresh history | Measure changed-partition overlap, global-index version coexistence and agreed backup retention |

Sequential processing is feasible for XSC and the inspected AllWISE files: each
partition has its own schema, row count and checksum and is locally readable.
The largest provider-listed AllWISE data file is 51,067,142 bytes, so one file at
a time is transferable within the investigation cap. That does not prove total
artifact fit or global-index size. Full Gaia partition size distribution and a
compatible final schema remain unmeasured. The source downloader's nine-column
output is not a full-record solution.

Existing infrastructure can hold the **measured XSC component** within this
investigation's reserved-space policy. An unchanged full AllWISE copy cannot fit
on the currently inspected Apps Server filesystem. Full-scope fit is **unproven**;
no additional infrastructure purchase is justified by an exact total from this
work. The second dedicated server's durable storage allocation and availability
have not been independently established; the task workspace must not be assumed
to be an approved permanent catalog store or added to Apps Server capacity.

Operational headroom for these experiments was chosen explicitly: 200 GiB free
space retained, a 4 GiB aggregate cap (3.5 GiB files plus 512 MiB scratch-DB reserve),
one worker and the existing task CPU/memory ceilings. At the evidence checkpoint,
file allocation was 2,878,672,896 bytes plus 151,273,472 bytes for the isolated DB,
and free task-filesystem space was 231,324,237,824 bytes. The final checkpoint, including subsequent report and reproducibility files,
was 2,932,756,480 allocated file bytes plus the same isolated DB, with
231,272,251,392 bytes free; no existing resources were
removed. Production growth/headroom, backup destination/capacity and recurring
refresh duration are unknown and must not be assigned invented exact values.

## Reproduction and verification

Activate the project's Python environment and use its existing optional bulk
requirements (`scripts/gaia_bulk_requirements.txt`). The experiments need PyArrow,
local Postgres for the isolated prototype audit, and SQLite with RTree support.
Do not point the audit at the shared staging/production database. These commands
create new investigation outputs; do not reuse paths containing existing artifacts.

```sh
python scripts/investigate_catalog_storage.py data/catalogs/gaia_local_stars.json data/storage-repeat/gaia
python scripts/inventory_allwise_parquet.py data/storage-repeat/allwise-metadata
python scripts/prepare_storage_prototype.py data/catalogs/gaia_local_stars.json data/storage-repeat/prototype.tsv
createdb -h /var/run/postgresql -U postgres skychart_storage_investigation_repeat
(cd data/storage-repeat && psql -h /var/run/postgresql -U postgres -X -d skychart_storage_investigation_repeat -f ../../scripts/catalog_storage_prototype_audit.sql)
```

Obtain the two XSC gzip files and `twomass_xsc_schema` from the
[official bulk release directory](https://irsa.ipac.caltech.edu/2MASS/download/allsky/).
Their exact byte sizes/checksums are in the evidence. Enforce the documented
space cap before downloading or rerunning the complete conversion:

```sh
python scripts/measure_xsc_partitions.py --schema data/storage-repeat/twomass_xsc_schema --output data/storage-repeat/xsc --limit 0 --max-seconds 1200 data/storage-repeat/xsc_aaa.gz data/storage-repeat/xsc_baa.gz
python scripts/verify_xsc_storage.py data/storage-repeat/xsc data/storage-repeat/twomass_xsc_schema data/storage-repeat/xsc_aaa.gz data/storage-repeat/xsc_baa.gz
python scripts/recompress_catalog_partitions.py --output data/storage-repeat/allwise-zstd data/storage-repeat/allwise-*.parquet
```

`--row-group-size 0` tests preserved source groups; `--byte-stream-split` tests
the additional lossless float encoding. `watch_catalog_scratch.py` observes the
owned XSC process's allocated files and unlinked temporary files at 100-ms intervals.
Checksums identify exact files; allocated bytes depend on filesystem allocation.
The report does not count warm library query times as server/browser performance.

The full Python suite passed **159 tests plus four subtests, with no skips**.
The storage checks include absence/null/zero/ID preservation and detection of
numeric/schema loss. The SQL audit rejects non-investigation database names.
The prototype-fixture generator reproduced its input bytes, full XSC checks passed,
and the bounded metadata inventory was independently reconciled to provider row
counts. The previously implemented application foundation was verified separately;
no application changes were made during this focused investigation.

Machine-readable evidence:
[`storage-investigation-2026-09-09.json`](../data/catalog-registry/storage-investigation-2026-09-09.json).
Original artifacts remain in the ignored investigation-owned working directory;
only the report, schemas/checksums/measurements and reproducible scripts are tracked.
