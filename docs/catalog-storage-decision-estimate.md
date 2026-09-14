# SkyChart catalogue storage estimate

**Decision estimate, 2026-09-14; practical-architecture revision.** This report
is intentionally approximate. It uses the exhaustive investigation's existing
receipts and provider inventories; it does not wait for the remaining full
measurements. All capacities are decimal TB (`1 TB = 10^12 bytes`) and represent
usable logical storage before any RAID, replication or erasure-coding multiplier.

## Decision

| Scope | Online low/base/high | Backup low/base/high | Managed total low/base/high | Recommended placement |
|---|---:|---:|---:|---:|
| Priority searchable data: Gaia, SIMBAD, 2MASS PSC/XSC, AllWISE source/MEP/Reject | 14 / 20 / 59 TB | 2 / 5 / 19 TB | 16 / 25 / 78 TB | **25 TB online + 5 TB backup** |
| Maximal 52-entry checklist, including Pan-STARRS, SDSS, both Legacy directories and compact AllWISE images | 245 / 386 / 1,904 TB | 84 / 181 / 648 TB | 328 / 567 / 2,553 TB | **400 TB online + 200 TB backup** |

The existing Apps Server had about 0.10 TB free during this estimate. It cannot
hold either scope. This is a capacity finding only; it does not authorize a
purchase, deployment, production import or infrastructure change.

The recommended practical design keeps compact immutable detail and routing data
online, uses catalog-at-a-time copy-on-write or delta rollback, and stores one
authoritative-source backup separately. It avoids counting Pan-STARRS's stated
150 TB provider database a second time as a full SkyChart normalized copy. The
recommendations are **30 TB total managed capacity** for priority data and
**600 TB total managed capacity** for the maximal checklist. Covering the high
case would require about 78 TB and 2.6 PB respectively.

## What each number means

- **M — measured:** complete bytes were downloaded or built and reconciled.
- **P — provider metadata:** a provider manifest, listing or stated database
  size; not locally measured owned storage.
- **E — extrapolated:** a full-release estimate from verified full-field receipts.
- **A — assumption:** a bounded planning allowance where no complete export or
  serving artifact exists.
- **U — unknown:** no independent byte estimate is asserted. The maximal scenario
  carries an aggregate allowance rather than silently treating these entries as
  zero.

For each scenario:

```text
online primary = retained original sources + normalized/detail data + serving artifacts
serving artifacts = ID/name/text + angular/physical routing + cross-identification + native tiles
online usable = (online primary + temporary build space + rollback overlap) × (1 + headroom rate)
managed total = online usable + separate backup repository

low:  rollback = 10% × largest single-catalog primary
      backup repository = 50% × retained sources
      headroom rate = 10%

base: rollback = 25% × largest single-catalog primary
      backup repository = 100% × retained sources
      headroom rate = 20%

high: rollback = 100% × largest single-catalog primary
      backup repository = 100% × all online primary
      headroom rate = 30%
```

Rollback remains online and is scoped to the largest catalog being refreshed;
atomic release pointers avoid duplicating every catalog at once. The backup
repository is separate and retains authoritative source bytes in the base case;
normalized data and indexes are reproducible. The high case retains a complete
primary copy when rebuild time is unacceptable.

### Practical architecture assumed by the base case

- Retain each pinned compressed source release once in owned object storage.
- Store full scientific fields in partitioned columnar detail shards. Keep
  identities, aliases, provenance and release manifests in Postgres; do not copy
  every billion-row payload into a heavily indexed relational table.
- Serve exact IDs through sorted or minimal-hash immutable indexes, angular
  discovery through hierarchical partitions, and map drawing through bounded
  native LOD tiles. Hydrate full records from the columnar shards.
- Build one catalog and partition at a time. Reuse investigation-owned scratch
  only after its checksums and release receipt commit.
- Publish releases through atomic pointers and retain copy-on-write deltas for
  the catalog being refreshed. Rebuild normalized data and indexes from the
  separately backed-up authoritative sources when necessary.

The estimate is logical usable capacity. Hardware redundancy, filesystem
reserve, object-store coding and site replication remain deployment multipliers
because no storage platform has been selected.

## Priority searchable-data scope

### Base scientific-data inputs

| Catalogue | Retained source | Normalized detail | Retained build projection | Base serving estimate | Basis |
|---|---:|---:|---:|---:|---|
| Gaia DR3 | 0.754 | 1.129 | 0.098 | 0.073 | E: 2,392 receipts, 1.292 billion rows; extrapolated by row to 1,811,709,771 rows; A: 40 B/row compact routing |
| SIMBAD `basic` + `ident` | 0.040 | 0.050 | — | 0.015 | A: 22,153,861 objects, 72,905,435 identifiers, 67+2 columns; consistent export unresolved |
| 2MASS PSC | 0.043 | 0.048 | 0.016 | 0.092 | M: 92 files, 470,992,970 rows; 0.080 TB combined exact/designation/angular index plus tile allowance |
| 2MASS XSC | 0.001 | 0.001 | — | 0.0004 | M detail and lookup, small remaining tile allowance |
| AllWISE source | 0.365 | 0.420 | 0.027 | 0.036 | M: 12,288 files, 747,634,026 rows; packed ID measured; A: 48 B/row all serving components |
| AllWISE MEP | 3.420 | 4.022 | 0.552 | 1.368 | P exact 792-part source inventory; E detail/projection ratios from 21 verified parts; A: 32 B/observation compact routing |
| AllWISE Reject | 0.202 | 0.224 | 0.017 | 0.014 | P exact 48-part source inventory; E detail/projection ratios from 24 verified parts; A: 32 B/row compact routing |
| **Total** | **4.823** | **5.895** | **0.710** | **1.598** | independently summed; rounding accounts for displayed precision |

The pre-serving sanity subtotal is:

```text
4.823 source + 5.895 detail + 0.710 retained build projections = 11.428 TB
```

That agrees with the requested roughly 11.4 TB check. The build projections are
temporary inputs for global indexes and tiles, so the capacity table counts them
under build space rather than as completed serving artifacts.

Gaia's extrapolation is based on these independently re-summed current receipts:

```text
1,292,067,779 verified rows
537,383,910,893 source bytes      = 415.91 bytes/row
805,295,217,716 detail bytes      = 623.26 bytes/row
 69,926,581,294 projection bytes  =  54.12 bytes/row
full-row extrapolation: 0.754 / 1.129 / 0.098 TB
```

MEP uses `detail/source = 93,568,850,808 / 79,554,979,004`
and `projection/source = 12,852,689,270 / 79,554,979,004` against the
3,419,775,536,324-byte provider manifest. Reject uses
`112,424,271,485 / 101,110,032,901` and
`8,415,490,524 / 101,110,032,901` against its
201,724,592,177-byte provider manifest.

### Priority capacity calculation

| Component | Low | Base | High | Evidence or formula |
|---|---:|---:|---:|---|
| Retained original sources | 4.740 | 4.823 | 4.944 | Exact sources plus ±8% Gaia E and 0.015/0.040/0.100 TB SIMBAD A |
| Normalized/detail data | 5.350 | 5.895 | 6.720 | Measured data plus Gaia/MEP/Reject receipt-ratio ranges and SIMBAD A |
| Indexes, routing, cross-identification and native tiles | 0.900 | 1.598 | 7.532 | measured PSC/XSC pieces; base compact routing uses 32 B per MEP/Reject row, 40 B per Gaia row and 48 B per AllWISE row |
| **Online primary storage** | **10.990** | **12.316** | **19.196** | sum of preceding three rows |
| Temporary build space | 1.000 | 2.100 | 11.110 | retained projections plus bounded partition/external-sort scratch |
| Rollback/release overlap | 0.772 | 2.203 | 14.886 | 10%/25%/100% of the largest scenario catalog primary (MEP) |
| Operational headroom | 1.276 | 3.324 | 13.558 | 10%/20%/30% of online primary + temporary + rollback |
| **Online usable capacity** | **14.038** | **19.943** | **58.750** | online rows summed |
| Separate backup repository | 2.370 | 4.823 | 19.196 | 0.5× sources / 1.0× sources / 1.0× primary |
| **Total managed capacity** | **16.408** | **24.766** | **77.946** | online usable + backup repository |

The largest missing priority artifact is MEP's global record lookup/angular
routing for 42.76 billion observations. The practical base uses 32 bytes per
observation (1.368 TB): fixed-width IDs, a compact immutable angular route and no
row-oriented SQLite duplication. The measured 170 bytes/row 2MASS PSC SQLite
component and 187 bytes/row combined DESI components show what the design must
avoid at this scale. The high case preserves the 160 bytes/observation fallback
if compact routing is not achieved.

## Maximal 52-entry checklist

Measured, extrapolated and provider-sized source inputs total **180.140 TB** when
both Legacy directories are included and SIMBAD/unresolved allowances are
excluded. Excluding Legacy as well gives **167.140 TB**:

```text
150.000 Pan-STARRS provider database scale
  8.590 compact AllWISE image products plus polar products
  3.736 SDSS PhotoObj provider listing
  3.420 AllWISE MEP provider manifest
  0.754 Gaia receipt extrapolation
  0.365 AllWISE source measured
  0.202 AllWISE Reject provider manifest
  0.074 all other measured/provider-sized entries
= 167.140 TB
```

This explains the roughly 167 TB check. Adding Legacy changes it materially:
the provider estimates 6.6 TB for Tractor and 6.4 TB for sweeps, and both are
required by the checklist, so the base retains **13.0 TB**, not only 6.6 TB.
The base scenario then adds 0.040 TB for SIMBAD and a 1.0 TB aggregate source
allowance for the other unresolved families.

Thus **167.140 TB is a source-evidence checkpoint, not a deployable-capacity
estimate**. The practical maximal base starts from 181.180 TB of retained source
inputs, reaches 252.758 TB after normalized and serving data, and reaches
566.840 TB after online workspace, rollback, headroom and a separate source
backup.

### Large-product effect in the practical base case

| Cumulative scope | Online primary | Online usable | Separate backup | Managed total |
|---|---:|---:|---:|---:|
| 48 entries excluding Pan-STARRS, SDSS, Legacy and images | 14.904 | 23.048 | 5.854 | 28.902 |
| plus SDSS | 21.680 | 31.180 | 9.590 | 40.770 |
| plus Legacy Tractor and sweeps | 40.980 | 58.566 | 22.590 | 81.156 |
| plus Pan-STARRS | 243.480 | 374.526 | 172.590 | 547.116 |
| plus compact AllWISE images and polar products | **252.758** | **385.660** | **181.180** | **566.840** |

Pan-STARRS remains the decision driver. Its 150 TB provider database scale is
counted once as a retained-source proxy; practical normalized and serving layers
add 37.5 TB and 15.0 TB rather than another database-sized copy. Compact AllWISE
images add 9.278 TB to primary storage and 19.724 TB to managed capacity. If
every object in the provider image prefix is retained, including the
uncompressed intensity alternative, image source bytes rise from 8.590 TB to
13.484 TB.

### Maximal capacity calculation

| Component | Low | Base | High | Evidence or formula |
|---|---:|---:|---:|---|
| Retained original sources | 167.586 | 181.180 | 207.850 | all 52 entries; provider-scale ranges and unresolved allowance included |
| Normalized/detail data | 25.246 | 53.500 | 250.667 | measured ratios plus practical incremental representations; high retains row-oriented risk |
| Indexes, routing, cross-identification and native tiles | 5.686 | 18.078 | 189.588 | compact columnar/immutable routes in low/base; high retains measured large-row analogues |
| **Online primary storage** | **198.518** | **252.758** | **648.105** | sum of preceding three rows |
| Temporary build space | 8.000 | 18.000 | 282.450 | sequential partition builds in low/base; high allows large concurrent rebuild scratch |
| Rollback/release overlap | 15.820 | 50.625 | 534.400 | 10%/25%/100% of the largest scenario catalog primary (Pan-STARRS) |
| Operational headroom | 22.234 | 64.277 | 439.487 | 10%/20%/30% of online primary + temporary + rollback |
| **Online usable capacity** | **244.572** | **385.660** | **1,904.442** | online rows summed |
| Separate backup repository | 83.793 | 181.180 | 648.105 | 0.5× sources / 1.0× sources / 1.0× primary |
| **Total managed capacity** | **328.365** | **566.840** | **2,552.547** | online usable + backup repository |

The maximal detail/index assumptions are deliberately visible:

| Group | Source low/base/high | Detail low/base/high | Index low/base/high |
|---|---:|---:|---:|
| 48 entries excluding the four large products | 4.86 / 5.854 / 15.03 | 5.48 / 6.95 / 21.80 | 1.10 / 2.10 / 17.55 |
| SDSS | 3.736 / 3.736 / 3.736 | 1.87 / 2.54 / 4.11 | 0.20 / 0.50 / 3.29 |
| Legacy Tractor + sweeps | 10.4 / 13.0 / 15.6 | 3.81 / 6.08 / 14.06 | 0.10 / 0.22 / 1.00 |
| Pan-STARRS | 140 / 150 / 160 | 14 / 37.5 / 208 | 4.2 / 15.0 / 166.4 |
| AllWISE image products | 8.590 / 8.590 / 13.484 | 0.086 / 0.430 / 2.697 | 0.086 / 0.258 / 1.348 |

Pan-STARRS's “nearly 150 TB” describes the provider's catalog database, not an
export file set. The practical base treats it as retained authoritative-capture
scale, then adds only 0.25× for the SkyChart columnar detail projection and 0.10×
for compact routing, cross-identification and tiles. The low case uses 0.10× and
0.03×; the high case preserves 1.30× and 1.04× if the provider scale fails to
represent export bytes and SkyChart needs row-oriented duplication. That
ambiguity is the main reason the maximal range remains broad.

SDSS detail uses 0.50×/0.68×/1.10× its 3.736 TB provider file listing; the base
ratio is anchored by the fully verified first file (`4,466,225 / 6,612,480`).
Legacy detail uses the measured first-Tractor-file ratio
(`13,975,781 / 22,213,440`) plus an allowance for distinct sweep fields.

### Source basis for all 52 entries

Base source values below are inputs to the maximal calculation. Tiny values are
shown in TB to keep the sum mechanically comparable. “Floor” means the measured
files are real bytes but release coverage is still unresolved; the aggregate
unknown allowance covers the remaining risk.

| Entry | Base TB | Class | Source basis |
|---|---:|:---:|---|
| simbad-basic | 0.040000 | A | row/schema analogue; full consistent export unresolved |
| 2mass-xsc | 0.000813 | M | complete source |
| 2mass-psc | 0.042672 | M | complete 92-file source |
| gaia-dr3 | 0.753508 | E | current receipts extrapolated by rows |
| allwise | 0.364544 | M | complete 12,288-file source |
| hipparcos | 0.000053 | M | complete main table |
| openngc | 0.000004 | M | complete NGC table |
| desi-dr1 | 0.022371 | M | complete FITS source |
| quaia | 0.001060 | M | complete IRSA export; distribution equivalence pending |
| erosita-dr2 | 0.002140 | M | complete audited FITS source |
| spiders-dr20 | 0.000107 | M | complete audited FITS source |
| bass-dr2 | 0.000001 | M floor | three measured files; release coverage pending |
| exoplanets | 0.000169 | M | complete audited snapshot |
| small-bodies | 0.001213 | M floor | four exports; atomicity unresolved |
| panstarrs | 150.000000 | P | provider says nearly 150 TB database |
| legacy-surveys | 13.000000 | P | 6.6 TB Tractor + 6.4 TB sweeps |
| sdss | 3.736374 | P | verified provider PhotoObj listing |
| nvss | 0.000078 | M | complete audited source |
| pulsars | 0.000001 | M | full distribution package |
| variables | 0.002164 | M | complete audited VSX table |
| clusters | 0.00000008 | M floor | measured files; release coverage pending |
| nebulae | 0.00000023 | M floor | measured files; release coverage pending |
| transients | U | U | aggregate unresolved allowance |
| supernova-remnants | 0.00000002 | M | complete summary table |
| messier | 0.00000010 | M | owned compilation, counted once |
| curated-landmarks | 0.00000117 | M | owned compilation, counted once |
| allwise-mep | 3.419776 | P | exact 792-part provider manifest |
| allwise-reject | 0.201725 | P | exact 48-part provider manifest |
| allwise-images | 8.589776 | P | compact product selection + polar products |
| erosita-ls10 | 0.001054 | M | complete audited crossmatch source |
| heasarc-neargalcat | 0.00000007 | M | complete TDAT source |
| ned | U | U | aggregate unresolved allowance |
| abell | 0.00000025 | M floor | measured files; release coverage pending |
| 2mrs | 0.00000398 | M floor | measured files; release coverage pending |
| 6df | 0.00000985 | M floor | measured files; release coverage pending |
| 3c | 0.00000006 | M floor | measured files; release coverage pending |
| 4c | 0.00000030 | M floor | measured file; release coverage pending |
| cta | 0.00000126 | M floor | paper source; transcription pending |
| 2qz | 0.00000396 | M floor | measured files; release coverage pending |
| virgo-cluster | 0.00000003 | M | complete source |
| fornax-cluster | 0.00000007 | M floor | measured files; release coverage pending |
| markarian | 0.00000010 | M floor | measured files; release coverage pending |
| apm | U | U | aggregate unresolved allowance |
| local-volume | 0.00000044 | M floor | measured files; release coverage pending |
| local-group | U | U | aggregate unresolved allowance |
| blazars | 0.00000048 | M floor | BZCAT5 candidate; original scope unresolved |
| solar-system-core | 0.00003273 | M floor | kernel measured; other metadata pending |
| mars-satellites | 0.00006759 | M floor | kernel measured; other metadata pending |
| giant-planet-satellites | U | U | aggregate unresolved allowance |
| spacecraft | U | U | aggregate unresolved allowance |
| nearby-stars-curated | U | U | aggregate unresolved allowance |
| small-body-satellites | 0.00000018 | M | complete requested API snapshot |

The seven `U` rows share a **0.1 / 1.0 / 10.0 TB** low/base/high source
allowance. Their detail allowance is 0.1 / 1.0 / 15.0 TB and their combined
index/tile allowance is 0.05 / 0.5 / 10.0 TB. These are scenario assumptions,
not catalogue byte claims.

## Known blockers and limits

- The AllWISE source and packed-ID measurements completed, but the queued Legacy
  wrapper checks `allwise-full/measurement.json`; the source worker writes its
  completion to `allwise-full/progress.json`. Legacy therefore remains queued.
  This estimate records the mismatch and does not repair it.
- SIMBAD has current object and identifier counts but no documented consistent
  full export in the evidence set. Its values are allowances.
- Pan-STARRS lacks an anonymous complete versioned bulk export in the audited
  route. The 150 TB value is provider database metadata.
- Image products are separated from searchable catalog records. The base chooses
  the compact gzip product set and excludes the same-name uncompressed intensity
  alternative; the high source case includes the full provider prefix.
- Global indexes, cross-identification evidence, native tiles and full-detail
  hydration have not all been built. Their bytes are estimates anchored by the
  measured 2MASS PSC and DESI components.
- Current partition workers may refine ratios, but no result from those workers
  is required for this decision estimate.

Evidence sources: [measured progress](catalog-storage-measured-progress.md),
[52-entry checklist](catalog-storage-exhaustive-checklist.md), and the
[machine-readable investigation ledger](../data/catalog-registry/exhaustive-storage-ledger.json).
