# Exhaustive SkyChart storage checklist

**Status: INCOMPLETE — resumed exhaustive investigation.** The previous report does not satisfy this task.

52 reconciled entries: 30 registry products and 22 additional integrations or named source references. Saved plans 4, 5 and 6 reviewed. Entries with unresolved releases remain in scope.

Current measured components and gaps for every entry: [generated measurement table](catalog-storage-measured-progress.md). Regenerate it with `python3 scripts/report_exhaustive_storage_progress.py`; the inventory below defines scope, while the generated table reports current evidence.

This checklist includes supporting images, observations and crossmatches separately. Names in curated landmark provenance are included even when no bulk integration exists. Their complete release must be resolved, not assumed to be the landmark sample.

| ID | Catalog / product | Pinned release | Origin | Measurement status |
|---|---|---|---|---|
| simbad-basic | basic + ident | unresolved | registry-v1.json; saved plan 5 | pending |
| 2mass-xsc | fp_xsc | All-Sky 2003 | registry-v1.json; saved plan 5 | full_detail_and_lookup_component_measured_other_artifacts_pending |
| 2mass-psc | fp_psc, all 60 fields | All-Sky 2003 | registry-v1.json; saved plan 5 | all 92 source/data partitions measured; global index building, other serving artifacts incomplete |
| gaia-dr3 | gaiadr3.gaia_source | DR3 | registry-v1.json; saved plan 5 | pending |
| allwise | allwise_p3as_psd | AllWISE 2013 | registry-v1.json; saved plan 5 | pending |
| hipparcos | I/239/hip_main | 1997 | registry-v1.json; saved plan 5 | pending |
| openngc | database_files/NGC.csv | 36cb178a0f69dba8bfc03a99c10512831edf1c6b | registry-v1.json; saved plan 5 | pending |
| desi-dr1 | zall-pix-iron.fits | DR1 iron zcatalog v1 | registry-v1.json; saved plan 5 | full resumable download running; 136-field header pinned; row count remains metadata until complete audit |
| quaia | G20.5 full source; G20.0 overlapping subset; associated maps/randoms distinct | Zenodo 10403370 v1.0.0 | registry-v1.json; saved plan 5 | source acquisition pending; seven products pinned |
| erosita-dr2 | eRASS3_Main_v1.3.fits | DE DR2 v1.3 | registry-v1.json; saved plan 5 | pending |
| spiders-dr20 | DL1_spec_SDSSV_eROSITA_eRASS3_allepoch-v1_1_0.fits | DR20 DL1 v1_1_0 | registry-v1.json; saved plan 5 | pending |
| bass-dr2 | J/ApJS/261/2/table9 | DR2 | registry-v1.json; saved plan 5 | pending |
| exoplanets | pscomppars, all 703 fields | Full-query snapshot 2026-09-09; SHA pinned | registry-v1.json; saved plan 5 | complete source measured; normalized/serving pending |
| small-bodies | SBDB Query | unresolved | registry-v1.json; saved plan 5 | pending |
| panstarrs | ObjectThin plus associated scientific products, views and metadata kept distinct | DR2 | registry-v1.json; saved plan 5 | corrected official TAP path verified; 69 table definitions and 5,602 column definitions pinned; full acquisition unresolved under 100,000-row TAP cap |
| legacy-surveys | full Tractor rows plus standard/extra/light-curve/photo-z sweep products | DR10 south; corrected DR10.1 sweeps | registry-v1.json; saved plan 5 | four sweep checksum manifests: 5,744 files; all 360 Tractor manifests: 366,912 files; one Tractor file measured; full source bytes, rows and serving artifacts unmeasured |
| sdss | PhotoObjAll | DR18 | registry-v1.json; saved plan 5 | pending |
| nvss | VIII/65/nvss | 1998 | registry-v1.json; saved plan 5 | pending |
| pulsars | psrcat | unresolved | registry-v1.json; saved plan 5 | pending |
| variables | VSX | unresolved | registry-v1.json; saved plan 5 | pending |
| clusters | VII/202 | 1996 | registry-v1.json; saved plan 5 | pending |
| nebulae | V/84 | 1992 | registry-v1.json; saved plan 5 | pending |
| transients | objects | unresolved | registry-v1.json; saved plan 5 | pending |
| supernova-remnants | Galactic SNR catalogue, summary and detailed/candidate documents | Green 2024 October; CDS VII/297 | registry-v1.json; saved plan 5 | full 310-row, 18-field summary data and exact lookup measured; detailed/candidate documents retained; their normalization and remaining serving artifacts pending |
| messier | Messier owned compilation | git 3ac7cf6f4358f990c46eb95fd826465d6147fa0c | registry-v1.json; saved plan 5 | complete 110-entry JSON measured: 98,411 bytes; serving artifacts pending; not an upstream archive measurement |
| curated-landmarks | curated_extragalactic_survey owned compilation | git 3ac7cf6f4358f990c46eb95fd826465d6147fa0c | registry-v1.json; saved plan 5 | complete 891-entry JSON measured: 1,169,351 bytes; overlaps upstream entries; serving artifacts pending |
| allwise-mep | allwise_p3as_mep | AllWISE 2013 | registry-v1.json; saved plan 5 | pending |
| allwise-reject | allwise_p3as_psr | AllWISE 2013 | registry-v1.json; saved plan 5 | pending |
| allwise-images | AllWISE Image Atlas | AllWISE 2013 | registry-v1.json; saved plan 5 | pending |
| erosita-ls10 | eRASSc3_Main_LS10_Public_27Jul2026.fits.gz | DE DR2 2026-07-27 | registry-v1.json; saved plan 5 | pending |
| heasarc-neargalcat | NEARGALCAT full 40-field TDAT | HEASARC export 2020-09-30; 2013 publication | scripts/build_heasarc_nearby_galaxy_source.py | full source measured; Local Volume overlap verified for names/positions/distances |
| ned | NED object database | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| abell | Abell galaxy cluster catalog | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| 2mrs | 2MASS Redshift Survey | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| 6df | 6dF redshift survey | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| 3c | 3C radio catalog | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| 4c | 4C radio catalog | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| cta | Caltech List A radio source catalog | Harris & Roberts 1960; PASP 72, 237 | scripts/build_curated_extragalactic_survey_catalog.py | full original paper measured; table transcription and serving pending |
| 2qz | 2QZ survey | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| virgo-cluster | Virgo Cluster Catalog, complete vcc.dat | J/AJ/90/1681; Binggeli+ 1985 | scripts/build_curated_extragalactic_survey_catalog.py | complete source measured; serving pending |
| fornax-cluster | Fornax Cluster Catalog | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| markarian | Markarian catalog | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| apm | APM survey | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| local-volume | Local Volume Galaxy catalog | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| local-group | Local Group catalogs (unspecified compilation) | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| blazars | blazar catalogs (unspecified compilation) | unresolved | scripts/build_curated_extragalactic_survey_catalog.py | pending_release_resolution |
| solar-system-core | DE440s + curated Solar System metadata | unresolved | backend/catalog_sources.py | pending_release_resolution |
| mars-satellites | MAR099s | unresolved | backend/settings.py | pending_release_resolution |
| giant-planet-satellites | Horizons Jupiter/Saturn moon vectors | pinned built-in metadata; ephemeris release unresolved | backend/catalog_sources.py | all 11 built-in metadata records measured; full dated vectors/caches/serving costs pending |
| spacecraft | Horizons support inventory + target metadata; trajectories separate | API 1.0 support snapshot and checked manifest SHA pinned | saved plan 4; scripts/audit_spacecraft.py | inventory/current manifest and all target metadata measured; trajectory/native artifacts pending |
| nearby-stars-curated | Curated nearby stellar systems | pinned built-in metadata | backend/catalog_sources.py | all 16 current records measured; overlapping upstream releases and serving artifacts separate |
| small-body-satellites | JPL SB-SAT, all records and documented optional data | API 1.0 snapshot 2026-09-10, SHA pinned | scripts/build_small_body_catalog.py | full snapshot and exact lookup measured; ephemeris/native artifacts pending |

## Duplicate reconciliation

Same provider/table/release counted once despite multiple integrations; overlapping objects in distinct catalogs remain separate records. Source and derived compilation artifacts count separately. Crossmatch tables are not duplicate source releases. Vague named families remain visible unresolved entries.

- gaia-dr3: gaia_local_stars; gaia_500pc_stars; bulk Gaia
- simbad-basic: simbad_extragalactic; simbad_compact_objects; landmark SIMBAD references
- hipparcos: bright_stars
- exoplanets: exoplanet_systems; nearby_exoplanet_systems (archive references only; curated facts separate)
- openngc: ngc_ic_deep_sky
- messier: deep_sky_catalog
- curated-landmarks: curated_extragalactic_survey
- small-bodies: jpl_small_bodies
- erosita-ls10: eROSITA LS10 counterparts (not full Legacy Surveys)

## Required artifact checklist

For every applicable entry: complete source release and schema; scientific detail; exact-ID routing; names/aliases/text indexes; angular and physical indexes; evidence-based cross-identification; native angular/physical LOD tiles; manifests and source documentation. Record explicit non-applicability with scientific justification, not zero-byte assumptions. Global indexes, association tables and cross-catalog routing must actually be built before their size is counted.

Keep source bytes, final data/index bytes, observed build workspace, and optional backups/rollback separate. An output may be recycled only after checksum, counts and final byte receipt are durably recorded; recording partition sums never completes unbuilt global artifacts.

The machine-readable ledger is [exhaustive-storage-ledger.json](../data/catalog-registry/exhaustive-storage-ledger.json). Previous XSC receipts are reused; its remaining serving artifacts are pending.

## Gaia execution checkpoint

The complete first source file (528,333 rows; 152 columns) passed provider MD5
and an independent second CSV parse compared against every Parquet value.
The all-field candidate is 352,304,048 logical bytes. Conversion plus full
verification took 52.6437 seconds; the 233,642,769-byte source downloaded in
about 4.2 seconds. A simple throughput estimate suggests roughly 50–60 hours
for the full 3,386-file manifest on the existing half-CPU task container.
This estimates runtime only; it is not a full-size measurement.

A single sequential worker is authorized and now runs without the prior arbitrary
10/20-minute limits. Free-space floor: 100 GiB, leaving over 120 GB available
for investigation on the current filesystem; one partition needs under 1 GB
at the first-file measurement. The existing 768 MiB container memory ceiling
remains in force. Production and staging databases are untouched.

Each output is fully verified, checksummed and measured before its durable
receipt is fsynced and the tool-owned temporary partition recycled. Downloads
are similarly measured and recycled; the existing first download is preserved.
The source schema and source manifest are pinned; changed manifests and invalid
receipts fail rather than silently resume. Global serving indexes, associations
and rendering artifacts are not included in these detail component receipts.

Resume command:

```sh
.venv/bin/python scripts/measure_gaia_full_partitions.py --root data/storage-exhaustive-1271/gaia-full --manifest data/storage-investigation-1271/gaia-source-md5.txt --existing-source data/storage-exhaustive-1271/GaiaSource_000000-003111.csv.gz
```

Progress: `data/storage-exhaustive-1271/gaia-full/progress.json`; per-file
counts, byte sizes, source/output checksums and row-group routing evidence:
`data/storage-exhaustive-1271/gaia-full/receipts/`. Full total remains unset
until all release files and required serving artifacts reconcile.

## Additional acquisition checkpoint

The complete Hipparcos main table has been acquired and counted: 118,218 rows,
53,316,318 source bytes. The ATNF 2.8.1 source package occupies 1,427,033 bytes;
its database contains 4,393 records, matching its own declared count.
These are source measurements; final serving structures remain unmeasured.

A pinned 70-file acquisition manifest covers the documented tables and supporting
text for Abell, 2MRS, 6dF, 3C/3CR, 4C, 2QZ, Fornax, Markarian, Local Volume,
NVSS, globular clusters, planetary nebulae and BASS. Its worker verifies each
full file's row count and checksum, recording failures separately. The documented
uncompressed total is about 358 MB (a feasibility figure, not measured storage).
The full manifest and completed-file receipts are in the registry ledger.

The prior foreground Gaia worker stopped after three files at the turn boundary.
It has been resumed as a detached process and verified advancing. A live process
and changing receipt count must be checked at each continuation; stored checkpoints
alone are not evidence that a worker is running.

## Retained build inputs and global routing

Gaia measurement now retains a 15-column workspace projection for later global
index and native tile builds, avoiding another full-release download for those
fields. It uses the ECSV-declared precision: RA, Dec, parallax and proper motion
remain float64; fields declared float32 use that source type. Full 152-field
detail measurements retain the existing decimal-to-float64 contract unchanged.
The first complete projection is 30,776,534 bytes and took 20.17 seconds including
verification. The revised runtime estimate is 70–80 hours. A roughly 100–120 GB
projection-workspace estimate is used for feasibility only, with the live free-space
guard still active; neither estimate is an exact full total. Earlier detail receipts
are reused while missing build projections are backfilled.

A real, resumable SQLite global ID-to-row-group routing artifact is now built
from verified receipts. It detects overlapping ID intervals and reconciles every
indexed row group. Its current receipt explicitly records partial coverage; it
cannot be called complete until all 3,386 files and 1,811,709,771 rows reconcile.
An ID range is only a candidate location: actual membership must be verified
inside the owned detail row group. Alias, angular/physical, association and
rendering structures remain separate unbuilt artifacts.

The additional 70-source-file batch finished with matching declared row counts:
97,573,157 downloaded bytes, 348,948,151 uncompressed bytes, 97,726,464 allocated
bytes. These measurements include compressed and plain source files and supporting
text; they are not final serving sizes or counts of distinct objects.

All 92 PSC file HEAD responses were acquired: their provider-reported sum is
42,672,321,835 bytes. This remains provider metadata. Only the first PSC gzip
file has been downloaded so far: 492,966,434 measured bytes, SHA-256 recorded
in the ledger; full stream row verification and conversion are still pending.

A ten-second observer now records owned workspace allocation plus the Gaia
process's open unlinked files. It started after earlier work, so its high-water
mark is sampled evidence, not an exact instantaneous or whole-session peak.

## Full PSC execution

The first complete PSC gzip file passed all-field verification: 5,144,500 rows,
60 fields, gzip CRC, matching detail/projection row counts, and a second full
source pass comparing every value. The detail component is 548,502,557 logical
bytes (548,507,648 allocated); its retained 12-field build input is 172,575,362
bytes. The source gzip is 492,966,434 bytes. Full-catalog totals are not inferred
from this file.

The measured processing time was 241.69 seconds while sharing the existing
half-CPU allocation with Gaia; peak PSC RSS was 298,228 KiB. Its source download
took 73.80 seconds. The complete 92-file PSC run has therefore started with an
8–10 hour estimate under that shared load. Each catalog processes its own files
sequentially; there are now two bounded conversion workers in the same existing
container. No additional compute allocation was requested. The observed combined
RSS was within the 768 MiB cgroup ceiling and no OOM kills were recorded. Avoid
additional heavy conversions until one worker finishes. The 100 GiB free-space
guard remains active for both.

PSC source downloads and detail temporaries are recycled only after fsynced
verified receipts. Build projections are retained for the actual global
ID/alias/angular/crossmatch/rendering builds. Process these after PSC completes
and recycle them when their required uses finish, before Gaia's workspace grows
large. The PSC release is not reconciled until all 470,992,970 rows and all 16
published integer verification sums match. Even then, global serving artifacts
and the full exhaustive catalog table remain required.

Resume command:

```sh
.venv/bin/python scripts/measure_psc_full_partitions.py --root data/storage-exhaustive-1271/psc-full --manifest data/storage-exhaustive-1271/acquisition/psc-complete-file-inventory.json --schema data/storage-exhaustive-1271/acquisition/psc-schema --existing-source data/storage-exhaustive-1271/acquisition/psc_aaa.gz --max-files 0
```

SIMBAD's live COUNT query reports 22,152,883 basic rows. Its advertised TAP
hard output limit is 2,000,000 rows. A single ordinary TAP result therefore
cannot deliver the full database; a consistent supported acquisition path is
still being investigated. Neither segmented mutable queries nor a selected
subset have been counted as a complete SIMBAD release.


Additional acquisition checkpoint: the complete SPIDERS DR20 v1_1_0 FITS file
was downloaded from the pinned SDSS URL: 107,196,480 logical bytes,
107,204,608 allocated bytes, SHA-256
`3382663d5232c1dbaefe67f4a32d9c7c4187d28633f024dafaeda107a95f0755`,
28.016 seconds. This measures source bytes only; FITS structure/schema/row
validation, normalized storage and serving artifacts remain pending. Receipt:
`data/storage-exhaustive-1271/acquisition/spiders-dr20-source-receipt.json`.
CDS's VSX versions listing was acquired and checksummed; the newest listed
archive is 2025-11-03, distinct from the current 2026-08-23 table. No older
archive is being silently substituted. Zenodo's Quaia record API retry timed
out after 20 seconds; this is a failed acquisition attempt, not evidence that
no supported acquisition path exists.

SPIDERS follow-up validation: all **263,310 rows and 49 fields** were read in
bounded batches using the existing fitsio 1.2.8 dependency. The whole-file
SHA-256 was independently rechecked; HDU extents fit the complete source file.
Full FITS headers, array shapes, units and per-field nonfinite/integer-null
sentinel counts are pinned in `acquisition/spiders-dr20-fits-audit.json`.
This supersedes the preceding structure-validation-pending note. The existing
importer selects 17 fields; measuring that subset would not meet the full-schema
requirement. Normalized storage and all serving artifacts remain pending.
Reproduce the source audit with:

```sh
.venv/bin/python scripts/audit_fits_source.py data/storage-exhaustive-1271/acquisition/spiders-dr20.fits 3382663d5232c1dbaefe67f4a32d9c7c4187d28633f024dafaeda107a95f0755 data/storage-exhaustive-1271/acquisition/spiders-dr20-fits-audit.json
```

Virgo source acquisition: all 2,096 rows reconcile with the pinned
[CDS ReadMe](https://cdsarc.cds.unistra.fr/ftp/J/AJ/90/1681/ReadMe).
The complete gzip is 34,447 logical / 36,864 allocated bytes, expanding to
146,720 bytes. SHA-256:
`0551b349e67cdc26114fa05cf93632f444a0612d6d84f9fb5044226f2a5cf224`.
The 1.200-second acquisition used the documented table via gzip after its
uncompressed URL returned 404. Coordinates are B1950, membership flags include
possible members and background galaxies, and velocity zero is a documented
null sentinel. All remain in scope. VII/85A was rejected as a candidate because
its ReadMe identifies Hickson compact groups, not VCC.

[Quaia release metadata](https://zenodo.org/records/10403370) is now pinned in
`data/catalog-registry/quaia-source-products.json`: seven named products and
provider MD5s, including the full G20.5 source and G20.0 subset. Provider row
counts are 1,295,502 and 755,850 respectively; they must not be summed as
independent sources. Synthetic random catalogs are separate supporting
products. The direct IPv4 G20.5 download HEAD attempt also timed out with zero
bytes after 25 seconds; acquisition remains unresolved, not proven impossible.

PSC global lookup preparation: `scripts/build_psc_lookup.py` follows the
measured XSC SQLite approach, with primary-key ID lookup, indexed designation,
file/row-group/row-offset routing, exact double RA/Dec and a candidate angular
R-tree. Each complete input file commits atomically; duplicate IDs or corrupted
inputs fail without losing earlier committed files. Missing positions remain
in lookup. A fixture verifies resume, rollback and IDs above 2^53.

**This index has not been measured at catalog volume.** Its complete-file trial
is queued behind the memory-intensive converters in the 768 MiB task cgroup.
Trial command (5,144,500 rows; no time cutoff):

```sh
.venv/bin/python scripts/build_psc_lookup.py data/storage-exhaustive-1271/psc-full data/storage-exhaustive-1271/psc-full/lookup.sqlite --max-files 1
```

Report that trial's observed time/workspace before running all inputs without
`--max-files`. Its bytes will account for only these built lookup structures;
photometry search, crossmatches, rendering and native API integration remain
separate work. Do not treat a partial index or fixture as the full serving cost.

Galactic SNR acquisition: the complete CDS VII/297 `snrs.dat` reconciles all
310 summary rows. It measures 19,799 logical / 20,480 allocated bytes,
SHA-256 `35272dfd445405c796bc2f3adbead14b77ec447edc0cbafca2402fbd7d6b8ad0`.
The [publisher bulk-download page](https://www.mrao.cam.ac.uk/surveys/snrs/snrs.paper.html)
provides the 2024 October documentation/candidate tables and detailed entries:

| Source document | Measured bytes | Allocated bytes | Parsed pages |
|---|---:|---:|---:|
| snr-catalogue2024-tables.pdf | 203,465 | 204,800 | 33 |
| snr-catalogue2024-table-V.pdf | 445,332 | 446,464 | 122 |

Both PDFs were read with pypdf 6.1.1 in strict mode and every page extracted;
page counts match the publisher listing. Original PDFs remain preserved,
alongside SHA-256 receipts and extracted-text hashes in
`data/storage-exhaustive-1271/snr-source/`. Extracted text is an audit aid,
not a lossless replacement for the source documents. All 310 summary records,
uncertainty flags and radio measurements remain in scope; detailed facts and
possible/probable candidates still need structured normalization. These
measurements do not account for serving indexes or tiles.

Reproduce the summary download using
`python3 scripts/acquire_catalog_source_manifest.py data/catalog-registry/snr-source-acquisition-manifest.json data/storage-exhaustive-1271/snr-source`.
The manifest pins the complete summary row count and ReadMe SHA-256. The
PDF receipts pin their direct publisher URLs and SHA-256 values; pypdf audits
use `PdfReader(path, strict=True)` and `page.extract_text()` on every page.

NEARGALCAT: the [HEASARC bulk TDAT export](https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_neargalcat.tdat.gz)
measures 68,385 compressed bytes and 171,443 uncompressed bytes, with 869 rows
and all 40 fields. SHA-256:
`fd8f0144e007cba84a2bce57efdb9f143c0ad6202c12d2ddfe063d755cb3cf33`.
The archive header pins modification 2020-09-28 and export 2020-09-30;
[provenance](https://heasarc.gsfc.nasa.gov/W3Browse/galaxy-catalog/neargalcat.html)
identifies a June 2013 derivative of the publication's Tables 1 and 2.
Full gzip decompression, the `<END>` terminator, 40 fields per row and 869
unique names were checked. The attempted FITS TAP response was an explicit
unsupported-format error and is recorded as rejected, not a catalog download.

All 869 names match the already acquired CDS Local Volume Table 1 exactly.
All distances match; maximum RA and Dec differences are respectively
3.334e-9 and 4.445e-9 degrees. Both representations remain in byte accounting,
but these matching records must not be counted as 1,738 independent galaxies.
Other field translations remain unchecked. The prior integration's positive
 distance filter removes no rows from this particular export: all 869 have
populated positive distances. This was measured, not inferred from its code.
Evidence and both input hashes are in `neargalcat-source/local-volume-overlap.json`.

To reproduce the TDAT row audit, decompress the pinned archive, extract the
field order from `line[1]`, split records between `<DATA>` and `<END>` on `|`
(removing the final empty delimiter), and require 869 rows with 40 fields.
The overlap comparison joins exact `name` to CDS Table 1 bytes 1–18, converts
its documented J2000 sexagesimal columns to degrees, and compares distance
from bytes 115–119. No positional nearest-neighbor matching or identity
mutation was performed. Normalized storage and serving remain unmeasured.

CTA resolves to Harris & Roberts (1960), *Radio Source Measurements at 960
Mc/s*, PASP 72, 237, DOI 10.1086/127521. The Caltech repository DOI returned
403, but the [NASA ADS paper archive](https://articles.adsabs.harvard.edu/pdf/1960PASP...72..237H)
provided the full 19-page paper: 1,260,582 logical / 1,261,568 allocated bytes,
SHA-256 `60fd493f35d98775fab72d12215fa9289ef1a0361dd2878c13b38cd04dc15fb2`.
Every page was extracted with pypdf 6.1.1; the parser reported an Xref-numbering
correction. The source paper states 106 entries, including 90 drawn from 3C.
Those are **publication-reported counts**, not independently validated table
transcription. The table uses 1950 coordinates. The full original scan is
preserved; OCR must not be promoted to scientific records without checking
all rows, signs, uncertainties and cross-identifications against the scan.

The [APM parent-catalog overview](https://people.ast.cam.ac.uk/~mike/apmcat/overview.html)
describes POSS-I and UKST plate catalogs. The landmark's
[discovery paper](https://arxiv.org/html/astro-ph/9806171) identifies a halo
carbon-star survey as its discovery context. These differ from the APM Bright
Galaxy and selected quasar products; no convenient subset has been substituted.
The official remote-access notes describe field queries. A supported complete
bulk release and its precise epoch/version remain unresolved; no mass paging
was performed. Documentation snapshots and SHA-256 receipts are retained under
`access-followup/apm-*`.

Exoplanet acquisition in progress: the complete `pscomppars` VOTable export
contains 703 field definitions, compared with the existing integration's
21-column query. Provider count before the request was 6,360. The first
transfer exceeded an internal 128 MiB review estimate and is explicitly
incomplete. That estimate was not a user limit: a detached retry now streams
with a live 100 GiB free-space floor, retaining all fields and rows. Its
checkpoint is `exoplanets-source/retry-full/progress.json`. At the observed
first-transfer rate, a similarly sized complete retry takes several minutes;
its exact size and successful row reconciliation remain unknown until done.

Reproduce/resume with `python3 scripts/download_exoplanet_storage_source.py data/storage-exhaustive-1271/exoplanets-source/retry-full`.
An interrupted mutable query restarts as a whole; it is never joined to an
HTTP-range fragment from another table state. The audit preserves FIELD
metadata and empty cells and rejects query errors, overflow and malformed
rows. A successful full query will be a dated snapshot, not a fabricated
named upstream release. Counts before and after do not prove all values
stayed unchanged. No normalized-storage or serving total is claimed.

Existing kernel files were measured without downloading replacements:

| Kernel | Logical bytes | Allocated bytes | Segments |
|---|---:|---:|---:|
| DE440s | 32,726,016 | 32,727,040 | 14 |
| MAR099s | 67,594,240 | 67,600,384 | 7 |

Whole-file SHA-256 values and every segment's target, center, frame, type and
Julian-date interval are recorded in `existing-kernel-measurements.json`.
These are complete local kernel-file measurements; segment counts are not
unique object counts. Curated metadata, dynamic caches, routing and other
serving artifacts remain separate unmeasured requirements. Reproduction uses
`jplephem.spk.SPK.open` on `data/skyfield/de440s.bsp` and `mar099s.bsp`, with
SHA-256 over each complete file.

Exoplanet retry completed: the full unfiltered PSCompPars TABLEDATA query
measures **169,497,514 logical / 169,504,768 allocated bytes**, with all
**6,360 rows and 703 fields** audited. Both bracketing provider counts were
6,360. Download plus audit took 389.65 seconds. SHA-256:
`05a3d85647ca7af16cf715bb3f4f7b42a0a1d004d33c30be93f1e0d0d7901b26`.
The full source preserves 28 empty distance cells, 324 empty stellar radii
and 50 empty planet radii. No distance/coordinate cut was applied. FIELD
metadata, units and empty-cell counts are in the full receipt; the initial
128 MiB transfer is not counted as another source representation. This
supersedes the earlier in-progress acquisition note, without changing the
remaining normalized-storage and serving requirements.

Full SBDB acquisition started after sequential pilots, using all 79 fields
advertised by `info=all`, plus `kind` separately verified as supported by the
API and required by the existing integration. The 1,000-row pilot measured
704,875 bytes in 8.01 seconds; the 10,000-row pilot measured 7,448,649 bytes
in 10.81 seconds. Provider metadata reports 1,567,287 objects. These are
**pilot measurements and provider counts**, not full-source totals.
The planning estimate is about 1.2 GB and 10–40 minutes for full acquisition
and audit; server preparation and row-size variation remain unknown.

The full run omits `limit` and filtering, requests full precision, sorts on
SPK ID, and streams one response with the existing live free-space guard.
It uses ijson 3.4.0.post0 for bounded-memory full row/field/count validation.
No archive paging or merging of mutable responses is used. Resume command:

```sh
.venv/bin/python scripts/download_sbdb_storage_source.py data/storage-exhaustive-1271/small-body-source/full data/storage-exhaustive-1271/small-body-source/info-all.json
```

A fully downloaded raw response is retained for audit retries. An interrupted
transfer restarts the complete query. Checkpoints and source contracts are
in `small-body-source/full/`. Covariance/observation products outside the
SBDB Query API, native orbit handling, normalized detail and serving artifacts
are not measured by this source-export job.

SBDB source audit rejected the first complete-query transfer: the response
ended inside a record after 1,079,326,989 bytes, and ijson raised premature
EOF. This is **not a complete source measurement**. The response and failure
are retained. A gzip-capability pilot returned uncompressed data. A second
full request is now running through Apps Server's independent network path;
this tests an alternative rather than presuming the cause of truncation.
No paged mutable results are being represented as a consistent release.

VSX full main-table acquisition is running for the pinned 2026-08-23 table.
HEAD reports 2,163,982,590 bytes and the 1 MiB range probe completed alongside
HEAD in 1.90 seconds. The full-table row target is 10,304,679. A conservative
10–70 minute acquisition estimate was published before launch; only the
completed local receipt will establish full measured bytes. Reference-table,
field-level and serving audits remain pending.

Existing Apps Server capacity was rechecked before the isolated index trial:
59,746,324,480 bytes available RAM, 260,912,246,784 free disk bytes, 8 CPUs,
load averages 0.13/0.27/0.33 and sampled CPU idle 82–95%. Temporary tools and
public investigation inputs reside exclusively in
`/tmp/skychart-storage-1271-psc-index`; no shared database was connected or
modified, and no application deployed. The first PSC file's 5,144,500 rows
are being indexed there. Actual cgroup settings were read back:

| Isolated job | CPU quota/period (microseconds) | Memory maximum |
|---|---|---:|
| PSC complete-file index trial | 25000 / 100000 | 536,870,912 bytes |
| SBDB full-source retry | 25000 / 100000 | 134,217,728 bytes |

Both run as the existing uid/gid 1000 through transient system services with
low scheduling weight. A user-service attempt did not persist after SSH logout
and was replaced without enabling lingering or changing permissions. Python
tools are confined to a temporary venv; no system packages were installed.
Follow-up free disk was 260,247,805,952 bytes with load 0.81/0.84/0.60. These
are investigation resources, not an approved permanent serving capacity.
The trials remain incomplete until their receipts and checks pass.

### Further measured evidence (2026-09-09)

The complete VSX main file dated 2026-08-23 was acquired and its 10,304,679
lines reconciled: 2,163,982,590 logical bytes, 2,163,990,528 allocated bytes,
SHA256 `68e22e1fff473fe7914313d71d531b5443ff35bb9aedc0ac294e3ad4d750fe77`.
Acquisition and line accounting took 1,412.77 seconds. Its separately dated
2022-05-30 bibliography contains 830,415 rows and 2,542,108 compressed bytes.
These are source measurements; field-level normalization, identifier checks,
bibliography joins and native serving artifacts remain outstanding.

The isolated PSC index trial on Apps Server built a real primary-ID lookup,
designation index, row-group routing and angular R-tree for the first complete
5,144,500-row partition. Integrity/accounting passed: 971,100,160 logical bytes,
971,104,256 allocated bytes, SHA256
`e5524acfc1411f1924bc3d83e7d121d14cdaf93fb340ce52c1636504cd00baac`.
Build plus validation took 1,037.19 seconds with a quarter-core CPU limit and
512 MiB memory limit; insertion alone took 587.68 seconds. This is one of 92
partitions, not a full index total. Nine sampled locators agreed with retained
projections. Repeated warm local query p95 times were 0.032 ms for ID,
0.024 ms for designation and 0.101 ms for bounded angular queries (90 each).
These do not establish cold-cache, full-release, API or browser performance;
full-detail hydration and crossmatches remain unverified. Experiment receipts
and the reproducible query script are linked through the machine ledger.

Both single-query all-field SBDB attempts ended in truncated JSON: the task
container received 1,079,326,989 bytes and Apps Server received 1,078,267,213.
Neither is a full source measurement. The alternate acquisition uses JPL's
four documented kind/numbering categories sequentially, preserving all 80
fields and avoiding offset paging. Category files still require global ID and
mutation reconciliation; they cannot establish an atomic snapshot by summing
counts. Documentation: https://ssd-api.jpl.nasa.gov/doc/sbdb_filter.html and
https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html.

All four SBDB category queries subsequently passed full JSON, schema, category
membership and row-accounting validation. Numbered comets: 610 rows/494,423
bytes; unnumbered comets: 3,466/2,221,166; numbered asteroids:
895,910/700,589,356; unnumbered asteroids: 667,301/510,180,406. The measured
category-source sum is 1,213,485,351 bytes across 1,567,287 rows. This is not
normalized storage, serving storage or proof of an atomic upstream snapshot.
Before/after provider counts agree for each category. The four full source
files and their SHA256 receipts are retained in the isolated Apps Server
workspace. Global ID/orbit-version reconciliation against an independent full
census is running; its SQLite file is audit workspace, not a serving artifact.

The full AllWISE sequential measurement is now running on Apps Server against
IRSA's pinned Parquet version dated 2023-04-10 (298 fields, 12,288 partitions).
The first additional partition reconciled 51,536 rows, provider MD5 and every
field/null: 24,844,419 source bytes, 28,038,895 candidate detail bytes and
1,869,170 bytes of retained build projection, in 18.907 seconds. Prior completed
measurements for HEALPix partitions 1091, 8438 and 8274 were reused after source
checksum verification; only their new build projections were generated.

The run uses a quarter-core CPU limit, 512 MiB memory limit, no swap and a live
100 GiB free-space guard. Its provisional runtime estimate is 70–100 hours,
not a deadline or measured full duration. It recycles only its own temporary
source/detail partition after a verified receipt and retains projections for
later global artifact builds. Candidate detail sums, source sums and build
projections remain distinct. This supersedes earlier statements that no full
AllWISE measurement was launched; it does not establish a complete serving
layout, full index size or fit on existing resources.

The SBDB full-field storage experiment completed on 2026-09-09: all 1,567,287
category records occupy 308,114,014 bytes of Parquet data. The global ID/name/
row-group lookup occupies 134,393,856 logical bytes (134,397,952 allocated),
with 3,165,057 name entries. Every field was compared with its source; global
accounting, SQLite integrity and eight offline hydration samples passed.
The 442,507,870-byte data-plus-lookup sum excludes audit/source workspace,
production API integration, cross-catalog evidence and ephemeris/rendering
artifacts. It is not the full serving requirement. Total experiment time was
1,467.90 seconds under the quarter-core limit.

VSX's complete field audit also passed: all 10,304,679 rows and 21 fields,
with zero numeric-format exceptions and the expected source checksum.
There are 5,470,670 blank period values and 8,657,742 blank epochs. Those are
unknown values, not zero. Full stored data and an ID/name/angular lookup are
now being measured separately; the existing source variability flags remain
attached to records and do not establish physical object identities.

A compact AllWISE ID-only lookup trial merged four complete partitions into
one sorted index. All 237,433 locators were verified against retained source
projections: 2,849,212 logical bytes, 2,850,816 allocated bytes, SHA256
`f1b1e0ffca2144d1287f2ff380301dd7dd6a6431010ea9793434c7d4035aa323`.
The run took 8.098 seconds under a quarter-core limit; 24 warm exact-ID lookups
had a maximum of 0.093 ms. It preserves full 64-bit IDs and rejects duplicate
IDs, invalid locators and truncated files. This prototype is an ID component
only; it cannot be compared as an equivalent replacement for the measured
SQLite ID-plus-designation index. Full-volume merge, designation lookup,
angular artifacts and native integration remain outstanding.

The full compact ID builder was launched on 2026-09-10 on the existing Apps
Server, isolated from application databases, with a quarter-core limit and
512 MiB memory limit. `scripts/build_allwise_packed_full.py` follows verified
source checkpoints, reuses the four trial sorted runs, and merges at most 64
runs at once. A complete next-stage manifest is committed before previous
intermediate runs are recycled. Interruption/resume tests verify that a failed
merge leaves its input stage intact. Source projections are never deleted.
At the declared release count, the format implies 8,971,608,328 final ID bytes
and approximately 18 GB of merge workspace; these are format-based estimates,
not measured full-release totals. The four-partition timing is not a reliable
full-volume merge forecast: the worker first depends on the 70–100 hour source
measurement estimate, then needs additional merge and validation time. Progress,
checksums, stage manifests and sampled workspace peaks are recorded durably.
Designation lookup, angular artifacts, cross-catalog associations and full
native serving measurements remain incomplete.

Full eROSITA DR2 `eRASS3_Main_v1.3.fits` source acquisition started on
2026-09-10 using `scripts/download_catalog_ranges.py`. The official archive
reports 2,139,595,200 bytes, ETag `"7f87a1c0-65229832a7b00"`, and modification
date 2026-05-19. These are provider metadata until the full file is received.
Sequential 8 MiB ranges retain checksums and resume offsets; changed validators,
ignored ranges and truncated replies are rejected. The transfer ceiling is
2 MiB/s (at least 17 minutes for the file, excluding validation and retries).
The first 109,051,904 verified bytes took 16.89 seconds of transfer time,
excluding intentional throttling. The task container had 213.5 GB free before
launch, and the worker used approximately 39.5 MB resident memory after launch.
The full schema documentation is pinned alongside acquisition evidence.
The published main-sample likelihood cut is not applied to this download, and
its selected-source count is not assumed to equal the FITS table row count.
Full FITS field/row validation, normalized storage and serving artifacts remain
pending. Source: [official release and data models](https://erosita.mpe.mpg.de/dr2/AllSkySurveyData_dr2/Catalogues_dr2/).

OpenNGC's pinned complete `NGC.csv` (commit
`36cb178a0f69dba8bfc03a99c10512831edf1c6b`) was measured on 2026-09-10:
13,969 records and all 32 fields occupy 957,791 logical / 958,464 allocated
bytes in the source-preserving Parquet layout. The exact-name/routing SQLite
component occupies 270,336 logical and allocated bytes. Their combined
1,228,127 logical bytes exclude source/audit workspace, aliases, cross-catalog
evidence, angular indexes/rendering and native integration. All source fields
were compared independently, all 13,969 records were hydrated through the
local index, and SQLite integrity passed. Blank strings and real zero strings
remain distinct; duplicate/nonexistent classifications remain source records.
The run took 6.295 seconds under the quarter-core limit. Checksums and the
pinned field guide are retained in the measurement receipt and Parquet metadata.
Reproduce with `scripts/measure_openngc_owned_storage.py SOURCE_ROOT OUTPUT_ROOT`.

Quaia's repeated Zenodo access failures now have an authoritative alternative:
[IRSA's Quaia archive](https://irsa.ipac.caltech.edu/data/Quaia/overview.html)
links DOI `10.26131/IRSA640` to the pinned Zenodo release. A metadata/count audit
returned 1,295,502 rows, 18 scientific fields and six archive-added fields.
The latter (`x`, `y`, `z`, `spt_ind`, `htm20`, `cntr`) are retained separately
from the scientific contract and are not interpreted as physical distances.
One documented asynchronous `SELECT * FROM quaia` export was submitted with
MAXREC 2,000,000, above the audited full count, and no extra magnitude cut.
The durable job reached COMPLETED before retrieval began. Its response reports
1,060,370,592 VOTable bytes: provider metadata until the download finishes.
At a 2 MiB/s ceiling this takes at least 8.43 minutes, plus network and audit
time. `scripts/finish_quaia_irsa_export.py` reuses the saved job, reads every
row, rejects overflow/errors, compares all 24 field names/types, and checks the
post-export source count. The endpoint lacks a stable byte-range validator;
an interrupted transfer restarts only its uncommitted local file, without
creating another upstream job. Original FITS byte equivalence, selection
function products, normalized storage and serving artifacts remain unmeasured.

The complete eROSITA main FITS byte download finished on 2026-09-10:
2,139,595,200 logical / 2,139,602,944 allocated bytes, 256 verified ranges,
SHA256 `4fe0a40f8d6cbd03ff51c5e8b5f665d7adfd04391ab4df99a6caa36053184059`.
Network transfer time was 296.15 seconds excluding intentional throttling and
final validation. Full FITS field/row validation is pending transfer to the
isolated Apps Server workspace at a 40 Mbit/s ceiling (at least 7.13 minutes).
No row count is claimed from completed byte acquisition alone.

VSX's full source-preserving detail conversion and second-pass verification
finished: 10,304,679 records, all 21 fields, 306,674,578 logical / 306,679,808
allocated Parquet bytes. SHA256
`bff7bb2647642c62c02e1e8470efef53f9c481b5f318c405f500eab27efbc4ca`.
The global ID/name/angular lookup is still being built. This measured detail
component excludes the index, reference integration and other serving artifacts.

OpenNGC's separate published-name/evidence and angular index is also measured:
5,009,408 logical / 5,013,504 allocated bytes, SHA256
`9353b96e102d941e918245e7b5a53e3eace247f2e31322e5114927ff67ded222`.
It retains all 13,969 records, including seven without angular coordinates;
13,962 positions have validated RTree bounds enclosing the exact source
astrometry. There are 52,925 distinct published-name evidence entries and 141
central-star relationship entries. All 53,074 original evidence occurrences
(including repeats) were verified against the index. Central-star names do
not become aliases for their parent nebula; cross-references do not merge
physical identities. Source J2000 sexagesimal coordinates are retained in the
full detail and converted only to angular degrees, without adding depth.
The run took 12.882 seconds under the quarter-core limit. This component is
counted once in the ledger, shared by evidence and angular lookup; native query
normalization, API integration, identity assembly, rendering and budgets remain
pending. Reproduce with `scripts/measure_openngc_evidence_index.py SOURCE_ROOT OUTPUT_ROOT`.

The eROSITA main full-file audit passed: 1,975,540 rows and all 250 fields were
read, including array/nonfinite/null-sentinel statistics and pinned FITS headers.
The audit took 57.918 seconds under the quarter-core limit. This independently
confirms the row count rather than assuming it from the published selection.
Normalized storage and serving artifacts remain unmeasured.

The complete IRSA Quaia export also passed: 1,295,502 rows, all 24 archived
fields, QUERY_STATUS OK, with matching before/after counts and schema.
Actual source size is 1,060,370,592 logical / 1,060,376,576 allocated bytes,
SHA256 `035c3d8b82fe14a8671d9727b0b6048cc0599eed313ce16de724bb53c2c53cf4`.
`scripts/measure_quaia_owned_storage.py` is prepared to retain every typed
field, verify every field against a second source pass, and build a resumable
ID/counterpart/angular index. The verified source is transferring to existing
isolated resources at a 40 Mbit/s ceiling (at least 3.54 minutes). The provisional
storage/index runtime estimate is 15–45 minutes at a quarter-core limit; neither
that estimate nor the source export size is a measured serving total. Original
FITS equivalence, selection-function products, native rendering and integration
remain outside these measured components.

The complete eROSITA–Legacy Surveys counterpart release
`eRASSc3_Main_LS10_Public_27Jul2026.fits.gz` is now downloading sequentially.
Its reported 1,053,710,795 compressed bytes and ETag
`"3ece59cb-65797161de4c0"` are provider metadata, not a completed measurement.
The 2 MiB/s ceiling implies at least 8.37 minutes before gzip/FITS validation.
This is a cross-match product, not an independent object population to add to
the main catalog's count. Its full field model is pinned in acquisition evidence.

Quaia's typed-storage worker is now running on the existing Apps Server with
a quarter-core CPU and 512 MiB memory limit; an early observed cgroup
memory reading was approximately 94 MB. It follows the previously published
runtime estimate and retains resumable row-group transactions for its global
index. No completed detail or index byte count is claimed yet.

`scripts/audit_compressed_fits_source.py` prepares the complete gzip/FITS audit
for the counterpart source. It records compressed and decompressed bytes and
checksums separately, verifies gzip CRC/length through EOF, and then runs the
full bounded FITS reader. Interrupted decompression cannot replace a completed
file; corrupt/truncated gzip and incomplete FITS-block regression tests passed.
The decompressed size and audit duration remain unknown until measured, with
the live-workload headroom guard applied throughout decompression.

The counterpart gzip download is complete: 1,053,710,795 logical /
1,053,716,480 allocated bytes, 126 verified ranges, SHA256
`32a7e85d6f5e309b153789f72e605c73c96fb8f920bfabc95211b5723f0b8a68`.
The complete file transferred to Apps Server and its gzip/FITS audit is running.
Compressed-source bytes are measured; decompressed size, rows and fields remain
pending that audit.

The shared CDS parser now recognizes single-byte declarations as well as byte
ranges. This is necessary for NVSS's declination sign and major/minor-axis limit
flags; all 29 NVSS fields are now included in its schema. Regression tests cover
those signs and flags. VSX's pinned schema already expresses single-byte fields
as ranges, and its parsed 21-field contract is unchanged.
`scripts/audit_nvss_source.py` is auditing the entire previously acquired
1,773,484-row NVSS gzip on Apps Server at a quarter-core/128 MiB limit. The
published source omits trailing blank positions in some records; the audit
pads those positions only for field inspection and retains the original bytes.
It checks the full decompressed byte and row counts, all numeric field syntax,
gzip integrity, and flag distributions. A preliminary 10,000-row width check
is explicitly a fixture check, not full-release verification. Stored detail,
source-name uniqueness, angular indexes and native serving remain unmeasured.

The complete counterpart gzip/FITS audit passed: **1,591,243 rows and 189
fields**. The decompressed FITS file measures 1,785,499,200 logical /
1,785,503,744 allocated bytes, SHA256
`b4eed06143c9cf7d0a2ae0a7e672b3853a9cd801b3442377ba15444d5347cac5`.
Decompression/CRC verification took 51.947 seconds and the full FITS audit
took 51.846 seconds, under the quarter-core limit. Compressed bytes remain a
separate source-package measurement; the decompressed file is audit/build
workspace, not an additional population or measured native serving artifact.

PSC input transfer recovered from an SSH/SFTP exit 255 while copying a receipt.
The last published receipt remained intact. Transport calls now retry at most
four attempts with 5/10/20-second backoff; command failures with other exit codes
fail immediately. Publication handles a disconnect after a successful rename
and continues to expose the receipt last. Retry exhaustion is an explicit
failure, not a completeness criterion; the same durable inputs can resume.
The focused retry regression passed and the transfer worker was restarted.

NVSS's complete field audit passed: all 1,773,484 records and 29 fields, zero
numeric-schema exceptions, matching compressed checksum and 277,851,724
decompressed source bytes. The full audit took 162.407 seconds. It verified
687,325 negative and 1,086,159 positive declination signs, and retained
1,489,153 major-axis and 1,732,910 minor-axis upper-limit flags. Full record
lengths range from 104 to 158 bytes because trailing blank positions are
omitted; all original bytes remain retained. These counts replace the earlier
fixture-only width observation. Normalized storage and indexes remain pending.

Quaia's complete typed detail component is verified: 1,295,502 records and
24 fields occupy 190,836,606 logical / 190,840,832 allocated bytes, SHA256
`079a2fe04f18a1aa6e35099152101abd2e67af1b42f4aae0e9d1f04781efb52b`.
Every field passed the second source comparison. The completed ID/counterpart/
angular index measures 210,702,336 logical / 210,706,432 allocated bytes,
SHA256 `ba0723fe9e530e14158b7071f2769281968515f5f6adba09ae16512455ae4d58`.
All 1,295,502 records are indexed; global counts, SQLite/RTree integrity, every
angular bound and 317 offline hydration locators passed. The data-plus-index
component sum is 401,538,942 logical bytes. Total experiment time was
1,135.283 seconds (18.92 minutes), within the provisional 15–45 minute estimate.
This excludes source/build workspace, selection functions, cross-catalog
identity evidence, native API budgets and native rendering. Full serving size
therefore remains unknown.

The complete NVSS storage/index measurement has started on existing isolated
resources using `scripts/measure_nvss_owned_storage.py`. It retains all 29
fields as source-precision text/nulls with the complete field guide, verifies
every stored field in a second pass, and builds resumable record/name/angular
lookup transactions. Ordinals identify records within the pinned release;
repeated names do not merge records. J2000 equinox centroids retain the source's
1995 +/- 2 observation epoch contract, without inferring physical distance.
Missing or invalid angular values remain available as records. The initial
cgroup memory reading was 136,675,328 bytes under a 512 MiB limit and a
quarter-core CPU limit. The provisional runtime estimate is 10–35 minutes,
not a measured duration or completion deadline. Two regression tests passed
for precision/flags, trailing blanks, coordinate rounding/signs, missing values,
and repeated-name preservation. Native API, identity and rendering artifacts
remain unmeasured.

VSX's complete data/lookup experiment finished: all 10,304,679 records have
local ID/name/routing and angular lookup. The index measures 1,841,586,176
logical and allocated bytes, SHA256
`0f594715aace509f5e1f3f067c0e6dfa0d34bb88cd9836a9fcdc31be48ce18c1`.
Together with its 306,674,578-byte detail, the component sum is 2,148,260,754
logical bytes. Global accounting, SQLite/RTree integrity and three offline
hydration samples passed; every detail field had already passed source
comparison. Total run time was 5,442.980 seconds (90.72 minutes). Bibliography
associations, cross-catalog identities, angular rendering and native API/latency
budgets remain pending, so this is not a full native-serving total.

`scripts/measure_fits_table_storage.py` now measures complete audited FITS table
data in bounded batches. It retains native numeric precision, source numeric
null sentinels, NaNs, fixed-array dimensions and FITS headers (including units,
TNULL and TDIM metadata). Unsupported field kinds fail explicitly. Every field
is compared against a second FITS read before a table receipt is accepted.
Non-table HDUs remain separately identified in the retained source; no indexes
or native serving size are inferred from table data. Regression tests passed
for endian conversion, 64-bit IDs, 69-element flags, multidimensional arrays,
NaNs, null sentinels and metadata preservation.

SPIDERS completed all 263,310 records and 49 fields with full value verification:
34,369,481 logical bytes (34,369,536 allocated), SHA-256
`679dfbdb009d01e8943b17ce47290dcb5bc01bffe1cd8c3c09e304b3dd04ecfe`,
16.81 seconds at a quarter-core limit. Its non-table primary HDU remains in the
retained source and is explicitly excluded from the converted table size.

The eROSITA main conversion failed with a confirmed cgroup OOM at its original
512 MiB limit, after progress reached 1,967,104 of 1,975,540 rows. No completed
table receipt was admitted. It was restarted with a 2 GiB limit after measuring
58,735,259,648 available RAM bytes and 199,503,323,136 free disk bytes on Apps
Server. CPU remains capped at a quarter core, with low I/O priority and no swap.
The earlier 10–30 minute estimate remains provisional; failed-attempt workspace
and time are not a completed measurement. Source-ID routing, angular/physical
indexes and rendering remain separate unfinished artifacts.

NVSS completed full source-field data and name/angular/routing lookup measurement:
1,773,484 rows, all with valid angular positions, and 1,773,484 distinct names.
Detail is 71,494,180 bytes; global lookup is 265,703,424 logical bytes
(265,707,520 allocated), for 337,197,604 logical bytes combined. Full-field
verification, global integrity/angular checks and 433 offline retrieval samples
passed. Runtime was 1,222.60 seconds. Cross-catalog identity evidence, native
rendering and API budgets remain unmeasured; this is not a full serving total.

Full eROSITA LS10 counterpart table conversion has started from its already
verified local source on Apps Server: 1,591,243 rows, 189 fields. This measures
an association product, not additional unique physical objects. The isolated
worker has a 2 GiB memory cap, quarter-core CPU limit, low I/O priority and no
swap. Provisional runtime is 10–30 minutes. An initial unsupported Boolean field
stopped conversion before acceptance; Boolean support was added and regression
verified before restart. Original decoded Boolean values are retained without
inference, alongside the source FITS headers and original source file.


Full eROSITA main table conversion completed: 1,975,540 rows, 250 fields,
1,429,300,866 logical bytes (1,429,307,392 allocated), SHA-256
`c36a7982d5442a91159b6743f90a51f97fb859b6f85d2d7838fe39a61136735d`.
All fields passed independent second-read verification. The successful attempt
used 433.32 seconds; this excludes the earlier failed attempt. Native serving
artifacts and total build workspace remain separate unfinished measurements.

A complete SPIDERS exact-field lookup is now building for `ero_detuid`,
`sdss_catalogid` and `sdss_id`. It preserves repeated identifiers and lossless
integer/text values with field-scoped keys and table/group/offset locations.
These are lookup entries, not assertions of object identity. Every locator is
verified, including resumed groups; final global counts and SQLite integrity
must pass before a receipt is accepted. Regression tests passed for duplicate
IDs, integer precision, resumed builds and modified source rejection. Estimated
runtime is provisionally 1–10 minutes with a quarter-core/512 MiB limit.

LS10 final update: unit EXITEDSUCCESS. All 1591243 rows / 189 fields verified. Detail 1016307291 logical bytes, 1016311808 allocated bytes, SHA fa9a9bc5bffde1e244beb16a9e872e75ccfb44378638c729dcd022e2401d0d50. Successful invocation 316.79 seconds. Collected erosita-ls10-owned-evidence/measurement.json. Do not report LS10 conversion still active. This is counterpart-table data, not unique objects or complete serving size. SPIDERS exact lookup remains active.


SPIDERS full exact lookup finished: 263,310 records, 789,930 field-scoped entries
for ero_detuid, sdss_catalogid and sdss_id. SQLite occupies 39,976,960 logical
bytes (39,981,056 allocated), SHA-256
`2b42f2135ac604be891563b223ad2a9835b85d80474c508a07c18f378b44108a`.
Every locator and global row/entry accounting passed, along with SQLite
integrity. Runtime was 87.11 seconds. Angular rendering, interpretation of
identification evidence and native API budgets remain outstanding.

The complete eROSITA main exact lookup is building for IAUNAME, DETUID and UID,
using the verified full table. Decoded types were checked as string, string and
int64 before launch. The provisional runtime estimate is 10–20 minutes based
on the completed SPIDERS run; bytes will be reported only from its own final
receipt. A 2 GiB memory cap accommodates the wide table's Parquet metadata,
with quarter-core CPU and low I/O priority. Apps Server had 58,755,772,416 bytes
of available RAM and 197,682,147,328 bytes of free disk before launch.


The complete Hipparcos I/239 hip_main.dat field audit passed: 118,218 records,
78 documented fields, zero numeric-format exceptions. Source size remains
53,316,318 bytes and its existing checksum is unchanged. The documented record
width is 450 bytes; the last defined field ends at byte 449, so the audit now
explicitly verifies the one trailing byte is blank. It never truncates or edits
the original source. Regression tests reject nonblank trailing content and
undersized width settings. Full audit runtime was 23.31 seconds on the task
container. Numeric RA/Dec, parallax and proper-motion fields are blank in 263
records; those records remain included. This is the main table only, not all
Hipparcos/Tycho annexes. Converted storage, indexes and native artifacts remain
unmeasured.


Full Hipparcos main-table storage is running from the existing verified source
and field audit. The converter preserves all 78 field values as original
precision text, with blank fields represented as null and original units,
flags and full CDS ReadMe retained as metadata. A second source read compares
every field before the completed table receipt is written. Original source
padding and delimiters remain in the retained source file. This measures table
data, not indexes or native rendering. Regression verification passed for
large identifiers, negative/zero/missing parallax, flags, metadata, completed
receipt reuse and modified-output rejection. Provisional runtime is 1–5 minutes
at a quarter core and 512 MiB memory cap on existing Apps Server resources.
Available RAM before launch was 58,345,197,568 bytes; free disk was
196,474,961,920 bytes. No shared database or application was changed.


Hipparcos main-table data measurement completed: 118,218 rows and 78 fields,
12,940,412 logical bytes (12,943,360 allocated), SHA-256
`635ee8441fdda6437918079d017f222840768ba269b4a6ea5dda4550e371cd3f`.
Every field passed second-read verification; runtime was 78.38 seconds.
Its complete exact lookup is now building for HIP, HD, BD, CoD, CPD and CCDM.
The lookup preserves field-scoped original identifiers and repeated references;
three regression tests passed, including CDS leading zeros and shared IDs.
Provisional runtime is 1–5 minutes at a quarter core and 512 MiB memory cap.

The eROSITA main exact lookup completed: 1,975,540 records, 5,926,620 entries,
279,613,440 logical bytes (279,617,536 allocated), SHA-256
`834c23cac3a2207089943e8ed8da7c16bb49d2eac6d0cbcf00921ada71b9445f`.
All locators, global counts and SQLite integrity passed; runtime was 652.99
seconds. The LS10 counterpart lookup is now building for IAUNAME, DETUID,
LS10_FULLID and ERO_LS10_FULLID with a quarter core and 2 GiB cap. A provisional
10–25 minute estimate follows from the completed main lookup; four fields and
longer string keys can change the runtime and size. No unique-identity claim
is made from these associations. Angular/rendering artifacts and native API
budgets remain separately unmeasured for both products.

Hipparcos lookup final update: completed successfully, 118,218 records and 377,781 field-scoped entries, 10,039,296 logical bytes (10,043,392 allocated), SHA-256 6239377c0ebe9c1818896d05823224c7727d47d9de163f1aad6ef6c4324f62ba. Every locator, global counts and integrity passed in 40.30 seconds. Hipparcos data plus this lookup occupy 22,979,708 logical bytes; angular/rendering and native serving remain unmeasured. Do not report the Hipparcos lookup as active. LS10 lookup remains running.


Complete 3C (1959), revised 3CR (1962), and 4C pinned CDS tables now have measured
data and exact-name lookups. 3C: 471 rows/27 fields, 41,786 data bytes and 28,672
lookup bytes. 3CR: 328 rows/19 fields, 35,022 data bytes and 24,576 lookup bytes.
4C: 4,844 rows/13 fields, 100,456 data bytes and 126,976 lookup bytes. Every
scientific field and exact-name locator passed verification, with global counts
and SQLite integrity checked. These are separate release records; 3C and 3CR
are overlapping catalogues and their rows are not a unique-object count.
Source 1950 coordinate epochs, radio-band fluxes, flags and notes are retained;
angular transformations, rendering and semantic identification remain pending.

Reproduce or resume with `python scripts/measure_radio_catalogs.py
 data/storage-exhaustive-1271` (one command). Original source checksums and
record-length distributions are retained; explicit short-record padding applies
only to field access and does not rewrite the acquired files. Strict width
validation remains the default for other callers. Five CDS regression tests
passed, including rejection of empty rows and implicit truncation/padding.
These three small tables were measured sequentially in the existing task
container; each component took under two seconds. No server or database change
was needed. Full serving sizes remain unknown.


Complete 6dF VII/259 catalogue and spectrum-metadata measurements are running
sequentially from the previously acquired gzip files: 124,647 catalogue rows
and 136,304 spectrum-metadata rows. These counts describe separate table types,
not their sum as unique objects. Compressed source SHA-256, gzip CRC and exact
expanded bytes are checked before field audit. Original scientific values,
redshift quality flags, null sentinels, epochs and documentation are retained.
Unnamed CDS delimiter fields receive stable byte-position labels while keeping
the original unnamed label in schema metadata. They are not dropped.

The driver is `python scripts/measure_6df_catalog.py data/storage-exhaustive-1271`.
It resumes from durable expansion, field, data and exact-lookup receipts.
Six focused regression checks passed, including truncated gzip preserving a
valid prior expansion and unnamed delimiter preservation. Provisional runtime
is 2–10 minutes on existing Apps Server at a quarter core, 512 MiB RAM, low I/O
priority and zero swap. Before launch, available RAM was 55,130,202,112 bytes
and free disk was 195,381,133,312 bytes. Spectrum image files are not included
in this table measurement. Angular rendering, spectrum-file acquisition scope,
identity interpretation and native serving remain separate unfinished work.


6dF's two table measurements completed. Catalogue: 124,647 rows, 27 fields,
4,664,457 data bytes plus 8,196,096 exact-lookup bytes. Spectrum metadata:
136,304 rows, 24 fields (including documented separators), 3,787,992 data bytes
plus 12,746,752 lookup bytes. All fields, 249,294 catalogue lookup entries and
408,912 spectrum lookup entries passed verification. Combined component size
is 29,395,297 logical bytes. Spectrum image files and native serving artifacts
are not included. The catalogue conversion/lookup took 32.00/17.81 seconds;
spectrum metadata conversion/lookup took 30.40/32.81 seconds, excluding audits
and expansion. The 6dF worker is finished.

BASS DR2's pinned J/ApJS/261/2 tables also completed sequentially on the task
container. Table 8: 1,449 observing rows/28 fields, 131,854 data bytes and
49,152 lookup bytes. Table 9: 858 property rows/14 fields, 89,991 data bytes and
61,440 lookup bytes. Table 11: 47 new-redshift rows/8 fields, 56,558 data bytes
and 16,384 lookup bytes. Total measured components: 405,379 logical bytes.
Source schemas, component flags, redshift fields and original precision are
retained. All fields, exact lookup locations, global counts and SQLite integrity
passed. These table counts are not a sum of distinct objects. Native angular
rendering, identification interpretation and API budgets remain unmeasured.

Reproduce/resume BASS with `python scripts/measure_bass_catalog.py data/storage-exhaustive-1271`.
Each component took less than two seconds. Replayed BASS and radio drivers
successfully reused completed receipts while rechecking source/data checksums.
No shared database, application deployment or new infrastructure was involved.


All seven pinned Local Volume J/AJ/145/101 science/reference tables completed
full-field and exact-lookup measurement. Table 1: 869 rows/27 fields,
101,851 data bytes plus 40,960 lookup bytes. Table 2: 869 rows/23 fields,
99,364 plus 40,960 bytes. Table 3 (photometry): 3,190 rows/6 fields,
80,691 plus 188,416 bytes. Table 4 (velocities): 761 rows/4 fields,
64,803 plus 53,248 bytes. Table 5 (HI widths): 610 rows/4 fields,
62,528 plus 49,152 bytes. Table 6 (distance moduli): 783 rows/5 fields,
65,473 plus 57,344 bytes. Bibliography: 346 rows/4 fields,
63,168 plus 40,960 bytes. Total data is 537,878 bytes; lookup is 471,040 bytes;
combined measured components are 1,008,918 bytes.

All original field precision, bands, limits, measurement methods, references,
source epochs and flags are preserved. All field values, exact lookup locations,
global counts and SQLite integrity passed. Repeated measurements remain separate;
the two 869-row property tables do not imply 1,738 galaxies. The prior exact-name
and distance comparison with the NEARGALCAT 869-row export remains the overlap
evidence, rather than counting a new physical population. Cross-table association
artifacts, native angular/physical rendering and API budgets remain unmeasured.

Reproduce/resume with `python scripts/measure_local_volume_catalog.py data/storage-exhaustive-1271`.
The seven small tables ran sequentially on the existing task container, and the
completed run was replayed to verify checksum checks and receipt reuse. No new
acquisition, production import or infrastructure spending was involved.


All eight acquired Fornax VII/180 tables now have measured full data and exact
lookup components. p2tbl2: 340 rows/20 fields, 57,520 data bytes and 24,576 index
bytes. p2tbl3: 2,338 rows/16 fields, 75,548 and 118,784 bytes. notes: 122 rows/3
fields, 41,114 and 24,576 bytes. The five p3 tables have 24 fields each:
p3tbl2 52 rows, 52,298/16,384 bytes; p3tbl3 79 rows, 53,181/16,384;
p3tbl4 120 rows, 53,681/16,384; p3tbl5 162 rows, 54,032/16,384;
p3tbl6 375 rows, 57,892/24,576. Total data: 445,266 bytes; exact lookup:
258,048 bytes; combined measured components: 703,314 bytes.

Original background and uncertain membership flags, B1950 astrometry, names,
notes, velocities and measurement precision are retained. Tables remain distinct;
background records are not treated as cluster members, and FCC numbers in
different contexts do not cause identity merges. The five p3 tables explicitly
use the shared `p3tbl*.dat` schema documented by CDS. Compressed sources are
checksum/CRC/expanded-size verified, with separate expansion receipts. All source
fields and lookup locations, global counts and SQLite integrity passed.

Reproduce/resume with `python scripts/measure_fornax_catalog.py data/storage-exhaustive-1271`.
The small tables ran sequentially in the task container and replay successfully
reused completed receipts. Seven focused CDS/gzip regression tests passed.
Angular transformations, rendering, cross-table association artifacts and native
API validation remain unmeasured; no full serving total is implied.


All five structured Abell VII/110A tables completed full data and exact lookup
measurement. Table 3: 2,712 rows/21 fields, 136,026 data bytes and 77,824 index
bytes. Table 4: 1,364 rows/44 fields, 131,450 and 49,152 bytes. Table 5:
1,174 rows/42 fields, 124,477 and 65,536 bytes. Table 6: 274 rows/41 fields,
89,995 and 24,576 bytes. Notes: 3,316 rows/4 fields, 97,773 and 204,800 bytes.
Total data is 579,721 bytes; lookup is 421,888 bytes; combined measured
components are 1,001,609 bytes. The acquired docu.txt remains a separate raw
source artifact and is not counted as structured table data.

All scientific field text, B1950 astrometry, classifications, uncertainty flags,
redshift information and notes are retained. All fields, lookup locations,
global counts and SQLite integrity passed. The S supplementary catalogue,
overlap-zone rows and prefix-dependent note references remain distinct; no
sum of those rows is presented as unique clusters. Native angular/physical
rendering, cross-table relationship artifacts and API budgets remain unmeasured.

Reproduce/resume with `python scripts/measure_abell_catalog.py data/storage-exhaustive-1271`.
Tables ran sequentially in the existing task container. A completed replay
verified source/data checksums and receipt reuse. No shared DB or deployment
was changed. Exact per-table checksums and allocated bytes are in the ledger.


LS10 exact lookup completed: 1,591,243 counterpart-table records, 6,364,972
field-scoped entries, 393,670,656 logical bytes (393,674,752 allocated), SHA-256
`497461e7e09ad77b7fd0e1d71b6b7fb29c2e19cc55177c5f1902859b61de7929`.
All locators, global counts and SQLite integrity passed. Runtime was 1,520.59
seconds (25.34 minutes), slightly above the provisional 10–25 minute range.
Together with table data, these components occupy 1,409,977,947 logical bytes.
This excludes native rendering and interpreted identity/association artifacts.
The LS10 worker is finished and must not be reported as active.

All ten pinned 2MRS J/ApJS/199/26 tables completed. Table 3: 44,599 rows/29
fields, 3,221,515 data bytes plus 1,609,728 index bytes. Table 4: 590 reference
rows/2 fields, 54,450/40,960 bytes. Table 6: 4,291 rows/7 fields,
143,597/167,936 bytes. Table 7: 14 rows/7 fields, 48,472/16,384 bytes.
Table 8: 324 rows/2 fields, 51,001/28,672 bytes. Table 9: 74 rows/8 fields,
51,161/16,384 bytes. Table 10: 87 rows/1 field, 45,747/16,384 bytes.
Table 11: 155 rows/1 field, 46,323/24,576 bytes. Table 12: 334 rows/11 fields,
58,564/28,672 bytes. Table 13: 4,857 rows/5 fields, 110,476/188,416 bytes.
Total data: 3,831,306 bytes; exact lookup: 2,138,112 bytes; combined: 5,969,418
bytes. Removal reasons, compromised-photometry lists, alternative redshifts,
reference codes and original units/precision remain available as separate
source tables. Their rows are not summed as independent objects or confused
with complete 2MASS XSC coverage.

All fields, exact lookup locations, global counts and integrity passed.
Reproduce/resume with `python scripts/measure_2mrs_catalog.py data/storage-exhaustive-1271`.
The ten tables ran sequentially on existing task resources, and replay verified
checksum checks and receipt reuse. Native rendering, cross-table relationships
and API budgets remain unmeasured. Full catalogue/serving totals remain incomplete.


The full acquired 2QZ/6QZ table set passed data and exact-lookup measurement.
Main catalogue: 49,425 rows/48 fields, 3,371,123 data bytes and 4,767,744 index
bytes. NGP repeat table: 926 rows/22 fields, 69,272 and 86,016 bytes. SGP
repeat table: 1,047 rows/22 fields, 73,567 and 90,112 bytes. 6QZ repeat table:
87 rows/22 fields, 42,061 and 24,576 bytes. Total data: 3,556,023 bytes;
lookup: 4,968,448 bytes; combined measured components: 8,524,471 bytes.

All original field values, classifications, redshift quality flags, observation
dates, signal-to-noise values and J2000/B1950 coordinates are retained. Repeat
observations remain separate records; source classifications are not replaced
by an assertion that every row is a confirmed quasar. Full-field comparison,
exact lookup locations, global counts and SQLite integrity passed. The shared
repeat-table schema is explicitly pinned to its documented CDS section.

Reproduce/resume with `python scripts/measure_2qz_catalog.py data/storage-exhaustive-1271`.
The sequential run completed on existing task resources, and replay verified
source/data checksums and receipt reuse. Original spectra, angular rendering,
interpreted associations and native API budgets remain separate unmeasured
artifacts; these components do not establish the full serving total.


All seven structured Markarian VII/172 tables completed data and exact lookup
measurement. Table 7: 1,469 rows/33 fields, 118,222 data bytes and 53,248 index
bytes. Notes: 39 rows/5 fields, 64,522/16,384 bytes. Table 6: 48 rows/13 fields,
68,377/16,384 bytes. Table 8: 818 rows/2 fields, 68,738/61,440 bytes. Table 9:
1,549 rows/2 fields, 70,458/90,112 bytes. Table 10: 1,517 rows/2 fields,
67,861/94,208 bytes. References: 195 rows/2 fields, 65,585/16,384 bytes.
Total data: 523,763 bytes; exact lookup: 348,160 bytes; combined: 871,923 bytes.
The acquired descrip.doc remains separately retained as source documentation.

Original 1950 coordinates, redshift conventions, secondary-object notes,
classifications, aliases and reference numbers are retained. All fields,
lookup locations, global counts and SQLite integrity passed. An independent
read-only query of table 10's exact-name index found 61 duplicated abbreviated
name groups containing 127 records; every match remains separately addressable.
No nearest-name identity merge is performed. Reference rows and aliases are
not summed as additional physical objects.

Reproduce/resume with `python scripts/measure_markarian_catalog.py data/storage-exhaustive-1271`.
The small tables ran sequentially on existing task resources. Replay verified
source/data checksums and completed receipt reuse. Angular rendering,
cross-table relationship artifacts, identity assembly and native API budgets
remain unmeasured; the full serving total remains unknown.


The pinned Harris globular-cluster release VII/202 completed: 147 rows and 42
fields, 49,830 data bytes plus 24,576 lookup bytes, totaling 74,406 logical
bytes. Full values, distance assumptions and source coordinates are retained;
sources.txt remains separate source documentation. This is the historical
147-record release, not a claim of current comprehensive cluster coverage.

All sixteen V/84 planetary-nebula tables completed full data and exact lookup
measurement. Total data is 1,228,868 bytes; lookup is 704,512 bytes; combined
measured components are 1,933,380 bytes. Per-table rows/fields/data/index bytes:

- nebulae--main.dat: 1143 / 15 / 107458 / 49152.

- nebulae--diam.dat: 1143 / 9 / 72426 / 49152.

- nebulae--dist.dat: 296 / 7 / 62802 / 24576.

- nebulae--dista.dat: 3017 / 7 / 76052 / 106496.

- nebulae--hbeta.dat: 991 / 4 / 68744 / 45056.

- nebulae--intens.dat: 1046 / 22 / 89726 / 49152.

- nebulae--iue.dat: 1715 / 8 / 82935 / 65536.

- nebulae--iras.dat: 774 / 21 / 96464 / 40960.

- nebulae--nir.dat: 365 / 12 / 68308 / 28672.

- nebulae--radio.dat: 689 / 8 / 67822 / 36864.

- nebulae--vel.dat: 614 / 14 / 72189 / 32768.

- nebulae--cstar.dat: 692 / 17 / 80121 / 36864.

- nebulae--notes.dat: 703 / 2 / 65104 / 36864.

- nebulae--pospn.dat: 347 / 12 / 70413 / 28672.

- nebulae--notpn.dat: 330 / 11 / 70437 / 32768.

- nebulae--refs.dat: 872 / 2 / 77867 / 40960.

Every field, lookup location, global count and SQLite integrity check passed.
Candidate and rejected-object lists, repeated measurements, central stars and
references remain separate records. Original bands, limits, distance models
and B1950/J2000 coordinates are preserved without inference. IUE's documented
77-byte width includes one trailing blank after field byte 76. NIR row 102 has
one verified extra trailing space beyond byte 105; an explicit 106-byte setting
preserves that layout evidence. All original source bytes remain unchanged.

Reproduce with `python scripts/measure_cluster_catalog.py data/storage-exhaustive-1271`
and `python scripts/measure_nebula_catalog.py data/storage-exhaustive-1271`.
Sequential runs and completed replays passed on existing task resources.
Five focused CDS regression tests passed. Spectral/image products, interpreted
associations, native rendering and API budgets remain separately unmeasured.


The initial additional-source acquisition batch is now independently reconciled:
70 pinned files, exactly 67 structured tables and 3 retained documents. Every
local acquired file was freshly SHA-256 checked, and each structured-table
receipt was matched to its pinned source, expansion (where applicable), schema,
row count, field count and completed lookup verification. Source files total
97,573,157 bytes; normalized structured data totals 91,154,951 bytes; built
indexes total 296,288,256 bytes. These are separate storage categories for this
batch only. They do not establish a full catalog-universe or serving total.

The complete per-file table is in `docs/catalog-additional-batch-measurements.md`.
Reproduce with `python scripts/reconcile_additional_measurements.py data/storage-exhaustive-1271 data/catalog-registry/additional-source-acquisition-manifest.json data/storage-exhaustive-1271/additional-components-reconciliation.json`.
The reconciliation regression rejects mismatched source hashes, row/field
counts and unverified lookup receipts. Remote data/index byte checks remain
those documented in their completed receipts; this reconciliation freshly
rehashes local acquired source files, not every remote artifact again.

Other registry releases, native angular/physical rendering, relationship and
identity artifacts, extra source products, build workspace, retained backups
and native API budgets remain unfinished. Large full-source and index workers
continue. No overall completion or universal coverage claim is made.


The full acquired PSCompPars exoplanet export is now being measured on existing
Apps Server: 6,360 rows and all 703 fields (323 doubles, 310 text fields and
70 integers). The scalar VOTable converter uses native float64/int32/int64/text
types, retaining full field metadata, uncertainties, flags and missing values.
Numeric arrays and unsupported types fail explicitly. A second source pass
compares every field before a receipt is accepted. Two focused regression tests
passed, including integer precision, NaNs, nulls and completed-output integrity.

The 169,497,514-byte verified export was copied from existing investigation
storage; no upstream query was repeated. The isolated worker uses a quarter
core, 512 MiB cap, 256-row batches, low I/O priority and no swap. Provisional
runtime is 5–15 minutes; final data size is not yet known. Identifier routing,
relationships, rendering and native API budgets remain separate measurements.


Full PSCompPars table measurement completed: 6,360 rows and all 703 fields,
14,906,263 logical bytes (14,909,440 allocated), SHA-256
`84f4d113c3ec198f45b1e6837706691e6b05eb697cbca5f206e4c6f89e4141f5`.
All scalar values and field metadata passed the independent second source
read. Runtime was 179.88 seconds, below the provisional 5–15 minute estimate.
The retained original VOTable remains separately measured source storage.

A full nine-field exact lookup is now building for systemid, sy_name, objectid,
pl_name, hostname, hd_name, hip_name, tic_id and gaia_dr3_id. Shared hosts and
catalogue references retain every matching planet record; these lookup entries
are not established object identities. The generic lookup accepts completed
scalar VOTable receipts, preserving the same source/hash verification gates.
Five focused lookup/VOTable regression tests passed. Provisional lookup runtime
is under three minutes at a quarter core and 512 MiB on existing Apps Server.
Angular routing, interpreted host/planet relationships, native rendering and
API budgets remain separate unfinished measurements.

Exoplanet lookup final update: completed successfully with all 6,360 rows and 46,057 non-null field-scoped entries, 1,708,032 logical/allocated bytes, SHA-256 01c542145b3ea1bce333055b851314f996b3ad97a574ceafe529d9185937b3db. Every locator, global count and SQLite integrity check passed in 6.19 seconds. Table data plus this lookup total 16,614,295 logical bytes. Do not report either exoplanet worker as active. Native angular/rendering, relationship and API artifacts remain unmeasured.


ATNF release 2.8.1 now has measured lossless source-record storage and exact
PSRJ/PSRB lookup for all 4,393 records. Record data occupies 1,096,007 logical
bytes (1,097,728 allocated), SHA-256
`1406d71932a9d6604ffd61b55549eb9dbc76884a4f441a23109be386a1e2523b`.
The index occupies 258,048 logical/allocated bytes, SHA-256
`8ef11da6844aa3750c4248cf3666387442ff8dc613a9171474afcb3e00b1e959`.
Combined measured components: 1,354,055 bytes.

Reconstructing the complete original database from stored header and records
produced its exact SHA-256
`29e423e5878d8b97e397425b6a1fe1529396a7b25909e3c1d56924641db6c63b`.
All 162 distinct source field tags, uncertainty digits, reference strings,
comments and record separators remain unchanged. Every record and index
location was verified, with global counts and SQLite integrity checked.
This is lossless source-record storage, not completed typed scientific
hydration, distance interpretation or native API integration. The original
package retains ancillary documentation and source files separately.

Reproduce/resume with `python scripts/measure_atnf_storage.py data/storage-exhaustive-1271`.
The run completed in 1.86 seconds on existing task resources. A regression
checks exact bytes, aliases, unterminated records and duplicate PSRJ rejection;
completed replay checks stored artifact hashes. Angular rendering, identities
and native serving budgets remain separate unfinished measurements.


The full pinned Virgo Cluster Catalogue J/AJ/90/1681 table completed: 2,096
rows and 13 fields, 45,592 data bytes (49,152 allocated), SHA-256
`6d991c02a5a8b5ddf6fdffb8d8aa01fc293b2718b1738b3a5b028b753f9f4ae2`.
Its 4,192 field-scoped VCC/ID lookup entries occupy 114,688 logical/allocated
bytes, SHA-256 `5cadffef2feb61220f3b899b248cfac5db15c2b5bbf130a3abcc8b330058b1a3`.
Combined measured components: 160,280 bytes. Data conversion and lookup took
1.24 and 1.10 seconds respectively on existing task resources.

All source fields and lookup locations, global counts and SQLite integrity
passed. A readback of stored membership flags found 1,275 members, 575 possible
members and 246 background objects. The original HRV=0 unknown-velocity sentinel
is preserved in 1,525 records and is not promoted to a physical measurement.
Original B1950 coordinates, names and classifications remain unchanged.
These are release classifications, not a new independent membership judgment.

Reproduce/resume with `python scripts/measure_virgo_catalog.py data/storage-exhaustive-1271`.
A completed replay passed source/data checksum checks and reused receipts.
Source gzip CRC and expanded bytes are retained in separate evidence. Native
angular transformations/rendering, relationship artifacts and API budgets remain
unmeasured, so no full serving total is implied.


Full HEASARC NEARGALCAT TDAT storage completed: 869 rows and 40 original fields,
115,004 data bytes (118,784 allocated), SHA-256
`0b1f6b4d93555dd7ba1ca547fcaef9a5f300a41e5a8feb59a721205e5ab9ab9f`.
The name/neighbour-name lookup has 1,737 field-scoped entries and occupies
81,920 bytes (86,016 allocated), SHA-256
`de15457ba96a6744ab6c8f05e2d34dd200976e72deeda1527682f21ae834e758`.
Combined measured components: 196,924 bytes. Data and lookup took 0.50 and
0.48 seconds respectively on existing task resources.

All 40 original field strings, metadata, bands, limits and empty cells are
preserved. Source gzip, decompressed TDAT and schema checksums were verified;
field order, record widths, all stored values, exact lookup locations, global
counts and SQLite integrity passed. Neighbour references are searchable source
facts rather than identity merges. The established overlap with Local Volume's
869 names and distances remains explicit; no extra physical population is claimed.
The previously rejected FITS request remains excluded from admitted source data.

Reproduce/resume with `python scripts/measure_neargalcat_storage.py data/storage-exhaustive-1271`.
Six focused TDAT/lookup regressions passed, including malformed data boundaries,
field order, null versus zero, exact names and lossless lookup behavior.
Completed replay checks source/data/index hashes and reuses receipts. Native
angular/rendering, interpreted relationships and API budgets remain unmeasured.


## Full PSC source/data milestone (2026-09-10)

All 92 files reconcile to 470,992,970 records and all 16 published integer
verification sums. Compressed source bytes actually read total **42,672,321,835**;
all-field verified candidate Parquet bytes total **48,263,451,660**
(48,263,995,392 summed allocated bytes). These now supersede the earlier
provider-only source total and partial-file status above. Full source/detail
temporaries were recycled only after per-file second-pass verification and
durable checksummed receipts. Retained build projections total 15,823,556,986
bytes; these are workspace, not additional final scientific data. A fresh
completion audit rehashed all 92 projections and checked their Parquet row
counts and columns. See `psc-full/completion-audit.json` and reproducible
`data/storage-exhaustive-1271/audit-psc-completion.py`.

PSC source and transfer workers finished. The remote global index remains
in progress; cross-identification, native rendering, full serving totals and
exact peak workspace remain incomplete. This milestone does not admit a
production release or establish SkyChart's final storage requirement.

SDSS DR18 imaging inherits DR17 with no new imaging population. The full
PhotoObjAll contract cannot be replaced by filtered PhotoObj or reduced
PhotoTag. Official rsync module access succeeded; a read-only full rerun301
file listing is running. Its listed bytes will be provider metadata only.
The official bulk guide asks users to arrange transfers over 1 TB through
the help desk; no external contact or large transfer has been initiated.
Evidence and pinned documentation are under `sdss-access/`.


## SDSS resumable metadata inventory and first-file verification

The initial whole-tree rsync listing ended without a recorded successful exit;
it is retained as incomplete evidence. `scripts/inventory_sdss_photoobj.py` now
checks and checkpoints each of 765 observing-run listings independently. Accepted
listings require successful rsync exit, validated unique paths and a pinned SHA-256;
resume verifies and reuses them. Directory sizes remain provider metadata. Initial
throughput suggests roughly an hour for this metadata inventory, with substantial
run-to-run variation; it does not predict full data acquisition time.

One complete DR18 inherited PhotoObj file passed the provider SHA-1 and full
139-field audit: 2,186 records, 6,612,480 source bytes and 4,466,225 candidate
Parquet bytes. All array fields, string identifiers, original metadata and rows
were preserved. MODE values include 1 (1,447), 3 (495) and 4 (244); no filtering
or undocumented reinterpretation was applied. This is one file, not a full
release measurement or a reliable full-size extrapolation. The release's
calibration correspondence, all other files and global serving artifacts remain
unverified. Evidence: `sdss-first-source/measurement-scope.json`.


## DESI full conversion queued

The full 28,425,963-row, 136-field redshift-summary conversion is queued behind
the ongoing download. It requires the complete 22,371,272,640-byte source to
match the official SHA-256, then a full FITS audit before conversion. It writes
100,000-row partitions with bounded 1,024-row batches and verifies every field
against a second source read. The earlier 10,000-row diagnostic suggests a
provisional 2–5 hour conversion allowance and roughly 10 GB of candidate data;
neither is a measured full result. Startup requires 140 GiB free and conversion
checks a 100 GiB free-space guard. These are adjustable live-workload margins,
not user-imposed storage limits. No source deletion or application import is
part of this worker. Global serving structures remain separate unfinished work.

Reproducible orchestration and state: `run-desi-full-conversion.py`,
`desi-conversion-feasibility.json`, `desi-conversion-worker-progress.json` under
`data/storage-exhaustive-1271/`.


## Complete JPL small-body satellite snapshot

The unfiltered SB-SAT API 1.0 response with `orb=1`, `sigma=1`, `phys-par=1`,
`fullname=1`, `class=1`, `confirmed=all` contains 531 records and measures
177,460 source bytes. All rows reconcile to the API count; all nested fields
round-trip without changing strings, integers, nulls, absent fields or references.
There are 495 confirmed and 36 unconfirmed records, referencing 511 distinct
primary designations. All 467 records lacking `sat_fullname` are retained.
88 records include default orbits and eight include physical parameters.

JSONL data measure 177,359 bytes, response metadata 116 bytes and the built
SQLite exact lookup 49,152 bytes: **226,627 bytes** combined. The pinned
31,722-byte documentation brings those measured components to **258,349 bytes**.
637 lookup entries were checked against original nested records with upstream
access unnecessary; parent relationships and repeated identifiers are preserved.
Completed artifact hashes and identical resume were verified. Original source
retention is separate from these candidate data/index/documentation bytes.

This is a complete requested API snapshot, not an archive of every historical
orbit. The API provides default primary-centric orbital elements where available;
these are not heliocentric coordinates. Missing epochs, orbital uncertainty and
reference frames remain unchanged. Dynamic propagation, primary-body association,
angular/physical rendering and native integration remain unfinished.
Evidence: `sb-sat-measurement.json`, `sb-sat-source/`, `sb-sat-owned-storage/`.
Reproduce with `scripts/measure_sb_sat_storage.py`.


## Spacecraft metadata inventory

The complete Horizons support inventory currently lists 250 target IDs and
measures 70,058 bytes. All IDs reconcile with the checked application manifest:
97 included and 153 excluded entries, no missing or additional target IDs. The
unchanged manifest at git `3ac7cf6f4358f990c46eb95fd826465d6147fa0c` measures
94,388 logical bytes (98,304 allocated). It is one source/stored metadata artifact,
counted once. Neither target solutions nor excluded entries imply distinct
spacecraft. Existing admission and availability policies remain unchanged.

A serial worker requests metadata only (`MAKE_EPHEM=NO`) for every target,
preserves the full JSON response, and checkpoints each accepted response with
a SHA-256. Its first response measured 3,046 bytes in 0.707 seconds; a provisional
10–30 minute acquisition estimate includes one-second request spacing and
variable provider latency. Existing checked decisions are not rebuilt.
Trajectory files, full dated position coverage, caches and native serving
artifacts remain unmeasured. Evidence: `spacecraft-inventory-measurement.json`
and `spacecraft-source/`; task-owned worker `acquire-spacecraft-metadata.py`.


## Blazar candidate release measured; original provenance unresolved

The broad blazar entry in the existing curated source strings does not identify
a specific upstream release. Roma-BZCAT fifth edition (2015), CDS VII/274, is now
a pinned, fully measured candidate; it does not establish the historical source
of those curated records or exhaust other NED/SIMBAD compilations.

The complete `bzcat5.dat` contains 3,561 records and 20 fields: 476,769 source
bytes, 143,047 candidate data bytes and a 221,184-byte built exact lookup
(7,122 Seq/Name entries), for **364,231 bytes** of data plus lookup. Full-field
comparison, every locator, SQLite integrity and unchanged hashes on resume
were verified. The 5,654-byte original ReadMe is retained separately and defines
J2000 coordinates, classification/candidate codes, redshift uncertainty,
photometric/radio/X-ray/gamma-ray units and documented zero missing-value
sentinels. Original field strings are preserved; no sentinel is interpreted
as a physical zero, and no cosmological distance or optical flux is invented.
Angular/global cross-identification/native rendering artifacts remain unbuilt.
Evidence: `bzcat-measurement.json`, `bzcat-source/`, `bzcat-owned-storage/`.

The BZCAT class census also matches the published release: 1,151 BZB,
1,909 BZQ, 274 BZG and 227 BZU, including all 92 BL Lac candidates.
Names are not unique: `5BZB J1701+3954` appears twice. Both original
records and lookup matches remain separate; the 3,561 release sequence
numbers are unique. No nearest-position or name-based identity merge occurred.


The spacecraft target metadata run has now finished: all **250 responses**,
**536,924 logical bytes**, no acquisition errors. A completed replay reused
the pinned files, and an independent pass rehashed every response, checked
its API signature and requested target ID, and reconciled all 250 IDs.
This completes the pinned metadata response set only. Captures have individual
timestamps; no atomic upstream release or complete trajectory storage is claimed.
The worker is finished. See `spacecraft-source/target-metadata/verification-complete.json`.


## Gaia routing artifact expanded

The existing global ID-to-candidate-row-group SQLite index was extended from
61 to 365 verified source files, accounting for 188,594,888 rows. It measures
7,364,608 logical bytes (7,368,704 allocated), with SHA-256
`ecb26f58f3834c7b2f3050cb06cd2b0665909c3db0a59d8e64a160ffa000eb59`.
The build took 22.70 seconds and passed row accounting, non-overlapping global
ranges and SQLite integrity checks. It remains a partial-release routing
component, not full exact membership, science hydration or rendering storage.

A read-only verification checks every retained projection checksum and every
row-group footer count/minimum/maximum against this index. Exact membership is
sampled in the first, middle and last groups of each indexed file, including
missing IDs inside otherwise valid ranges. Such a range locates a candidate
group; it never proves an object exists. This does not benchmark full scientific
record hydration or the native APIs. See `gaia-full/routing-projection-verification*`
and task-owned `verify-gaia-routing-projections.py`.

Routing verification finished successfully in 119.50 seconds: all 365 projection
checksums and 229,418 group boundaries matched. All 3,285 sampled present IDs
and 1,095 sampled within-range missing IDs behaved correctly. The index hash
was unchanged throughout verification. This is still partial Gaia coverage.


## APM parent catalogue acquisition remains unresolved

The provider's HTTPS public `pub/apmcat/` directory is accessible but contains
only the parent-directory link. Its `pub/mike/apmcat.c` client is available;
that software constructs positional queries, not a complete export, and its
legacy HTTPS query route returns 404. The exact linked HTTP interface at
`apm3.ast.cam.ac.uk/~mike/apmcat/interface.html` still serves a form requiring
RA/Dec, box size, survey and equinox. No full release file inventory or export
is documented on these inspected routes. This is an acquisition gap, not a
zero-byte catalogue or proof that the data no longer exists.

A supported versioned bulk path and full schema/coverage manifest are still
needed; provider contact has not been authorized or sent. Mass positional
paging and smaller derived/merged catalogues do not establish complete original
POSS-I/UKST source coverage. The current home page describes Tycho-2 J2000
calibration while the older overview describes PPM; the actual release must
resolve that distinction. Responses, status codes, source client and hashes
are retained in `apm-access/`, with `acquisition-gap.json`.


## Full SDSS provider file inventory verified

All 765 observing-run listings are now complete and independently verified:
raw checksums, every filename's run/camera relationship, and category accounting
passed. The listing worker has finished. These are **provider-reported sizes**,
not measurements of downloaded scientific files or final owned storage:

| File category | Files | Provider-reported bytes |
| --- | ---: | ---: |
| PhotoObj | 938,046 | 3,736,373,967,360 |
| PhotoField | 4,590 | 2,704,302,720 |
| PhotoRun | 765 | 11,016,000 |
| Published SHA-1 manifests | 765 | 69,771,129 |

Saved raw listing metadata itself measures 72,019,782 bytes. The independent
audit took 45.61 seconds. Full scientific row counts, downloaded file checksums,
release/calibration coherence, conversion and serving structures are unfinished.
The official guide asks users to arrange transfers above 1 TB, which covers
the full PhotoObj volume. This is a provider request for a more efficient
transfer method, not evidence that the public files are technically inaccessible. No such bulk transfer or external contact has been initiated.

All 765 published checksum files have now been acquired: **69,771,129 actual
bytes**, containing 943,401 checksums for science and auxiliary files. Each
covers exactly its listed run, with no duplicate or unlisted paths. These are
metadata measurements, not evidence that the referenced scientific files have
been downloaded or verified. Accepted metadata files are hashed and resumable.
Evidence: `sdss-run-inventory/verification.json`,
`sdss-run-inventory/checksum-file-inventory.json`, and `sdss-checksum-inventory/`.
