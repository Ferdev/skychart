# Cosmic Atlas: astronomer and astrophysicist review

Task 1267 · 8 September 2026 · reviewed commit `390217134a9054ff8d4aaf9d23d95ca6b5c0911c`

**Assessment:** Cosmic Atlas has a compelling foundation for exploring astronomical scale and connecting catalog records. For professional work, its largest gap is the transition from inspecting an object to producing a defensible, reproducible scientific result. I would prioritize consistent scientific semantics, sample selection, cross-matching, and exportable analysis before adding another large catalog.

In the requested professional-user perspective, **I would pay a subscription for a workspace that preserves my samples, explains every derived quantity, links observations across archives, and reproduces the result in a notebook.** Observing campaigns and monitored target lists could support additional paid workflows. Basic correctness, provenance, and access to public source records should remain baseline capabilities.

This is a source-based review with targeted executable probes, not a production usability study or a claim of actual customer purchasing intent. The local Phoenix health endpoint was unavailable, so no browser walkthrough, deployment benchmark, or live survey completeness audit was performed. Only this report is changed; recommendations below are not implemented fixes.

## Existing strengths to preserve

The implementation goes beyond the project summary. It already includes an observer-relative, horizonless sky view; a location-based “Sky tonight” calculation; eROSITA and SPIDERS layers; spacecraft; on-demand Horizons refinement for small bodies; an events feed; shareable views; and PNG export up to 8,000 pixels wide. These are starting points to extend, not missing features.

Scientific disclosure is unusually valuable: the [methodology](scientific-methodology.md) and [semantics registry](../backend_phoenix/priv/science_semantics.json) distinguish measured, inferred, and literature distances; disclose survey selection; retain depth where available; and identify modeled context. The atlas uses actual survey points rather than fabricated cosmic structure. Object inspection exposes source links and uncertainty summaries, and imagery has attribution and explicit fallback behavior.

The [immutable tile pipeline](tile-format.md), bounded detail hydration, catalog audits, and [CI workflow](../.github/workflows/ci.yml) provide a useful technical foundation. CI already covers Python, frontend, Phoenix, and browser behavior. The opportunity is to strengthen scientific agreement across those boundaries, not rebuild the infrastructure.

## Highest-priority scientific issues

Priorities here describe impact on professional use: **P0** means resolve before presenting derived measurements as research-ready; **P1** means address in the next scientific reliability milestone; **P2** means a workflow extension. “Reproduced” means an isolated call to project code, not a live UI reproduction.

### 1. P0 — Static and dynamic coordinates do not consistently share an orientation

**Evidence:** In [scientific_calculation.py](../backend/scientific_calculation.py), `radec_distance_position_payload` rotates catalog coordinates using a fixed 23.4392911° obliquity. `vector_payload` instead uses Skyfield’s `ecliptic_frame`, and the Horizons path uses its time-dependent `rotation_at`. [coordinates.ts](../src/coordinates.ts) also uses a fixed J2000 obliquity when converting back to equatorial coordinates.

**Reproduced:** For the identical ICRS unit direction RA=0°, Dec=0°, the static transform and the dynamic frame rotation at 2026-09-08 differ by **1,351.478 arcseconds**, approximately **22.5 arcminutes**. This is an orientation consistency probe; it does not imply every object has that positional error. Nevertheless, subtracting vectors expressed in these different orientations is not a valid general relative-position calculation.

**Recommendation:** Establish an explicit canonical frame, origin, equinox, position epoch, and time scale. Transform each source into that frame before combining it with another source. Keep coordinate orientation separate from proper-motion propagation. Prefer a standard astrometry library for the transformations.

**Acceptance:** The same fixed ICRS direction agrees through catalog, ephemeris, sky-view, and inverse-coordinate paths at several dates. Reference tolerances must be stated and justified for the intended use, with separate budgets for transformation error and source uncertainty. Geometric, astrometric, and apparent directions must be identified; these are distinct ephemeris products in the [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html).

### 2. P0 — Missing distances can become physical positions and measurements

**Evidence:** [PublicObjects](../backend_phoenix/lib/starsmap_api/catalog/public_objects.ex), `public_spatial_fields`, correctly returns null spatial coordinates for OpenNGC records without suitable distance evidence. [CatalogObjectMapper](../src/catalog/catalogObjectMapper.ts), `map`, defaults missing coordinates to zero. Separately, X-ray importers assign unknown-distance sources finite coordinates on a disclosed 1 Gly reference shell. [ObjectComparisonView](../src/object/objectComparisonView.ts) checks coordinate finiteness, not whether the distance is measured.

**Reproduced:** A null-coordinate input maps to `(0, 0, 0)` with zero heliocentric distance. A synthetic reference-shell object carrying `distance_unknown: true` produces a numerical comparison and a “Light time” row.

**Consequence:** A scientifically honest “unknown” can become a location at the Sun or a measured-looking separation from a display shell. A methodology link cannot make that calculation valid.

**Recommendation:** Represent measured spatial positions, angular-only records, unavailable positions, and display coordinates separately. Preserve unknowns through hydration. Make angular-only objects searchable and inspectable in the sky view; exclude display-shell radii from physical distances, nearest-neighbor science, and statistical volumes.

**Acceptance:** OpenNGC null-distance and eROSITA shell fixtures remain selectable without producing heliocentric distance, physical pair separation, or light time. Angular separation remains available when both objects have valid sky coordinates. A real object at the origin must remain distinguishable from an absent position.

### 3. P0 — Comparison does not respect cosmological distance conventions

**Evidence:** [ObjectComparisonView](../src/object/objectComparisonView.ts), `update`, sends every pair separation to [educationalComparisons](../src/navigationMetrics.ts), which always computes distance divided by the speed of light. There is no cosmological distance-kind gate. The object science panel already avoids deriving lookback time from distance; the comparison panel needs the same discipline.

**Consequence:** A comoving coordinate separation is presented using a “Light time” label. It is not generally an elapsed photon travel time. Mixed literature and cosmological coordinates also require explicit conventions before being interpreted as a physical association.

**Recommendation:** Provide separately named projected separation, compatible 3D separation, angular separation, comoving distance, luminosity distance, angular-diameter distance, and lookback time. Expose the adopted cosmology and suppress unsupported combinations. Astropy provides distinct calculations for these quantities; its [FlatLambdaCDM reference](https://docs.astropy.org/en/stable/api/astropy.cosmology.FlatLambdaCDM.html) is a suitable independent validation reference.

**Acceptance:** A redshift-based object never receives a cosmological lookback time from distance/c. A redshift grid agrees with an independently configured reference using the same cosmological assumptions. Objects at different observed redshifts are not described as a simultaneous dynamical configuration without an explicit model.

### 4. P1 — Unknown sizes and cosmological extents need stronger semantics

**Evidence:** `ObjectComparisonView.sizeModel` substitutes denominators for zero radii and still constructs a diameter ratio. A probe comparing an unknown-radius source with a 100 km radius object returned **“Origin is 200.0x Unknown X-ray source.”** No such ratio is known.

The [eROSITA importer](../scripts/import_erosita_dr2_catalog.py), `build_object_row`, calculates `extent_ly` from angular extent multiplied by comoving distance. That is a comoving transverse extent in the adopted flat cosmology. If interpreted as proper extent at emission, it needs angular-diameter distance, introducing a factor of `1/(1+z)`. An X-ray catalog extent parameter also needs its source definition before being called an object's diameter.

**Recommendation and acceptance:** Suppress ratios when either radius is unknown or invalid. Label estimated stellar radii and source-defined extents at the point of comparison. Preserve the distinction between comoving extent, proper extent, catalog profile parameter, and physical diameter. Test missing radius, non-finite radius, and a known-redshift angular extent.

### 5. P1 — Uncertainty disclosure is partial and does not support analysis

**Evidence:** [scienceSemantics.ts](../src/scienceSemantics.ts) hard-codes a subset of uncertainty fields. Its `DistanceKind` union omits several values present in the JSON registry. `measuredRedshift` recognizes only `redshift_comoving`; SPIDERS uses `spectroscopic_redshift_comoving`, and its importer supplies `redshift_err`.

**Reproduced:** A SPIDERS fixture with `redshift=0.5`, `redshift_err=0.001`, and `sdss_zwarning=0` returns null from `measuredRedshift` and “Uncertainty not supplied by this atlas source” from `uncertaintySummary`. Raw facts may still contain the values; the scientific summary loses them.

Beyond this defect, neither a single error field nor parallax signal-to-noise constitutes propagated positional covariance. The Gaia paths inspected use inverse positive parallax with quality cuts; professional inference needs an explicit estimator, applicable zero-point treatment, and uncertainty model. Gaia DR3's reference epoch, astrometric properties, and parallax systematics are documented by [ESA](https://www.cosmos.esa.int/web/gaia/dr3).

**Recommendation and acceptance:** Validate registry values against runtime types, normalize source fields without discarding their provenance, and test every supported position model. Offer covariance or posterior-aware derived quantities where inputs support them. Keep missing errors explicit; distinguish statistical and systematic uncertainty, upper limits, confidence levels, and estimates. Do not invent formal errors from quality flags.

### 6. P1 — Stellar epoch behavior differs across ingestion paths

**Evidence:** [RowMapper](../backend_phoenix/lib/starsmap_api/catalog/importer/row_mapper.ex), `propagate_stellar_position`, shifts eligible catalog positions to a fixed target epoch, default J2026.0. The [bulk Gaia pipeline](../scripts/gaia_bulk_pipeline.py), `partition`, projects original RA/Dec without that propagation. The on-demand Gaia payload in [PublicObjects](../backend_phoenix/lib/starsmap_api/catalog/public_objects.ex) likewise uses original RA/Dec and does not attach a position model in `gaia_payload`.

**Consequence:** A high-proper-motion star may have different position semantics depending on how it is loaded. The selected atlas date is not a common stellar position epoch. The README's statement that proper motion is not applied is also incomplete relative to the importer.

**Recommendation and acceptance:** Define a shared propagation contract, retain original astrometry, and show source epoch and displayed epoch per record. For research propagation, handle spherical motion, radial velocity where available, and covariance rather than simply adding RA/Dec offsets. Compare an identified high-proper-motion star through snapshot, tile, and hydration paths. Missing proper motion must preserve the original epoch with an explicit limitation.

### 7. P1 — Observing support exists, but its time and coverage are constrained

**Evidence:** [ObjectInspectionView](../src/object/objectInspectionView.ts), `requestObservation`, sends a key and location without the selected atlas timestamp. [http_transport.py](../backend/http_transport.py) explicitly rejects fixed observing timestamps outside test mode. [observe_payload](../backend/scientific_calculation.py) resolves only Python `BODY_BY_KEY`, whereas search includes additional Phoenix and bulk-catalog objects. It samples the next 24 hours at five-minute intervals without atmospheric refraction or local obstructions.

**Assessment:** “Sky tonight” is a useful current-time aid, but it is not a planner for an arbitrary selected date or all searchable targets. The horizonless sky overlay is a separate feature and should remain clearly distinguished from topocentric observing predictions.

**Recommendation and acceptance:** Show calculation time prominently now. Extend to explicit dates, target-coordinate resolution, elevation, twilight, Moon separation, airmass, local horizon, and exposure windows. Display rise/transit/set results as dated quantities. Test circumpolar and never-rising targets, midnight boundaries, and a Phoenix-only catalog target; validate against established observing calculations such as [astroplan](https://astroplan.readthedocs.io/en/latest/).

### 8. P1 — Share links and image provenance do not yet freeze a research result

**Evidence:** [viewState.ts](../src/viewState.ts) encodes a catalog-release parameter. However, [AtlasViewStateController](../src/navigation/atlasViewStateController.ts) retains it as state while [CatalogPointManifestRepository](../src/catalog/catalogPointManifest.ts) fetches the configured versionless manifest. The inspected path does not resolve that parameter to an archived release. `current()` prefers the currently loaded manifest version.

[AtlasSharingController](../src/atlas/atlasSharingController.ts) supplies PNG exports with one atlas timestamp, one manifest version, and a fixed attribution string. This is useful image provenance, but does not capture each source epoch, selected rows, query, uncertainties, transformations, or the live detail payloads used.

**Recommendation and acceptance:** Add a downloadable research bundle containing the table, selection expression, source identifiers/releases, checksums, per-source epochs, frame, cosmology, software version, citations, and executable reconstruction. A saved release must resolve to the same retained data or fail explicitly. Test reopening a saved result after advancing the current manifest. Retain exports even if a user ends a subscription.

## Missing workflows with the highest scientific return

These are product opportunities inferred from the inspected source, API routes, and UI modules. They are not claims that external astronomy tools lack these capabilities.

| Opportunity | Current starting point and gap | A useful first deliverable |
| --- | --- | --- |
| Build and analyze samples | Search supports text, groups, types, and bounded pagination. No general scientific expression builder or linked analysis table was found. Its `total` is a pagination lower bound, not an exact sample count. | Cone/polygon and distance/redshift selection; unit-aware filters for magnitude, parallax quality, mass and classification; exact count or explicit estimate; table/map linked selections; saved query. |
| Cross-identify physical sources | Catalog aliases and key-based deduplication exist. They do not establish a physical identity across Gaia, Hipparcos, exoplanet hosts, SIMBAD, DESI, BASS, and X-ray detections. | Import a user table; epoch-aware positional matching; angular errors, alternative counterparts, match provenance, and explicit one-to-many relationships. Keep detections, components, hosts, and systems distinct. |
| Explore astrophysical parameter space | The atlas emphasizes spatial exploration and object pairs. No linked CMD/HR diagram, redshift distribution, or general parameter plot was found. | Brush a color–magnitude or proper-motion plot and see the same sample on the map. Add error bars, upper limits, reddening assumptions, and downloadable plotted rows. Later add SEDs, spectra, and light curves from source products. |
| Understand depth and selection | Depth exists in many records, but the primary map collapses it. Survey and sampling caveats are largely explanatory metadata. | Linked sky/physical views, Galactic coordinates, depth slices and redshift wedges; interactive survey footprints and coverage masks. Distinguish source population, quality-selected subset, and displayed sample. |
| Connect to the research ecosystem | Source links, a JSON API, agent endpoints, citations, and PNG export already exist. No user-facing VOTable/FITS table exchange, SAMP bridge, or general TAP query workflow was found. | CSV/ECSV and VOTable export with units and nulls; reproducible Python notebook; then SAMP exchange, FITS tables and TAP/ADQL integration. Keep 64-bit source identifiers lossless. |
| Inspect multiwavelength evidence | Curated images and survey cutouts exist, including fallback imagery. These are context images rather than a measurement workspace. | Linked angular image panels with WCS, band, observation epoch, angular scale, PSF/resolution and footprint; catalog overlays with positional errors; original calibrated product links. |
| Return to a continuing investigation | Recent destinations, share links, and a global current-events feed exist. No persistent private research project, personal change monitor, or campaign workflow was found. | Named target lists, notes, tags, saved selections, data-change diffs, and opt-in alerts with provenance. Preserve the previous result when refreshing. |

The [IVOA standards catalog](https://www.ivoa.net/documents/) supplies established exchange and discovery standards including VOTable, SAMP, TAP, HiPS, and MOC. An integration approach would reduce custom format work. [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/) is a relevant building block for interactive survey imagery. Footprints alone are not completeness corrections: survey inference also needs selection functions, quality cuts, and appropriate weights. The [DESI DR1 documentation](https://data.desi.lbl.gov/doc/releases/dr1/) is the source of record for its release products.

**A research experience worth building:** I import a target list, resolve identifiers and ambiguous matches, select a quality-controlled sample, brush outliers in a linked parameter plot, inspect their images and spectra, save my reasoning, and export a notebook that reconstructs exactly those rows. When a source release changes, I receive a reviewed diff and can keep the original analysis intact.

For stellar work, start with a nearby-star CMD and proper-motion sample. For extragalactic work, start with X-ray/optical counterpart inspection and redshift quality. For observers, start with a saved target list and one night's validated visibility windows. These are separate use cases; pick one for the first paid pilot.

## Features I would pay for

The willingness below is a professional-persona judgment, conditional on reliable implementation. It is not customer research, a price forecast, or evidence of product–market fit.

| Paid capability | Willingness | Why it could justify recurring payment | Minimum proof before charging |
| --- | --- | --- | --- |
| Reproducible research workspace | **Strongest** | Repeatedly saves the work of assembling samples, tracking versions, and explaining a result to collaborators or referees. | A saved sample reopens unchanged; exports retain units, masks, IDs, citations and reconstruction code. |
| Managed cross-matching and enrichment | **Strong** | Removes repeated archive joins and makes counterpart ambiguity reviewable, especially for multiwavelength targets. | Reference matches and ambiguous fields are evaluated; large jobs resume safely; alternatives and unmatched sources are retained. |
| Team projects and review history | **Strong for a lab** | Preserves shared selections, annotations, provenance, and decisions between people and observing runs. | Access controls, revision history, export, backup restoration and ownership transfer are demonstrated. |
| Uncertainty-aware linked analysis | **Strong when integrated with saved samples** | Makes exploratory science faster while leaving the statistical assumptions inspectable. | Results agree with an independent notebook; covariance, limits, selection and estimator assumptions survive export. |
| Observing campaign planner | **Conditional on observing role** | Reduces recurring scheduling work across targets, nights and instruments. | Date/location semantics and constraints are validated; schedules expose rejected windows and their reasons. |
| Target and catalog change monitoring | **Conditional, potentially strong** | Surfaces relevant ephemeris, classification, publication, or catalog updates without manually checking every archive. | Alerts identify the actual changed field, old/new values, source timestamp and failed refreshes; user controls noise. |
| Publication and proposal bundles | **Useful within a subscription** | Produces coordinated figures, captions, tables and citations from a saved analysis. | Figures state projection and sampling; every plotted selection can be reconstructed. |
| More catalogs, cosmetic 3D, or generic AI chat alone | **Low** | Additional display options do not by themselves complete a recurring research task. | Evaluate only when tied to a specific validated workflow. |

I would package the first paid offer around **saved, reproducible samples plus managed cross-matching and notebook export**. Keep browsing, source access, scientific caveats, correctness fixes, and small interoperable exports available without a subscription. Larger hosted jobs, storage, retained snapshots, team features, and monitored refreshes create recurring service value; estimate their operating costs before setting limits or prices.

[TOPCAT](https://www.star.bris.ac.uk/~mbt/topcat/) already supports rich table analysis, cross-matching, plots, scientific file formats, and interoperability. The commercial advantage therefore has to be an integrated, persistent workflow that demonstrably saves time. Interview and pilot with working astronomers before choosing pricing. Measure repeat use, time to a reproducible result, match-review effort, and whether exported outputs enter actual research work.

## Delivery order and verification gates

1. **Scientific consistency first.** Resolve findings 1–3; fix unknown-size ratios and registry mismatches; document all position epochs. Add numerical cross-pipeline fixtures for missing positions, mixed distance kinds, frame conversion, and stellar propagation. Update inconsistent documentation alongside those future fixes. Gate quantitative claims on those checks.
2. **One complete research workflow.** Deliver table import, structured sample selection, explicit counts, linked map/table/plot selection, saved queries, and a reconstructible export. Use modest datasets with independent expected results. Establish a usable angular view for objects without distance.
3. **Paid pilot.** Add reviewed cross-matching, private saved projects, version retention, and managed jobs for one domain. Success means a researcher can reproduce a result after a refresh and saves recurring effort compared with their current tools.
4. **Expand from evidence.** Add team work, monitoring, observing campaigns, deeper spectra/time-series integration, and publication bundles according to pilot demand. Integrate established tools before implementing equivalent analysis engines.

For the DevOps part of this review, retain the existing Docker/CI structure. Add value through scientific release integrity: record source and transformation versions, test catalog/detail/tile agreement, audit declared sampling against actual counts, and preserve release artifacts. Exercise upstream timeouts with cached and uncached objects separately. Display failed detail hydration distinctly from an absent astronomical source. A checksum validates bytes, not the scientific meaning of those bytes.

The existing scientific guardrails include source-text assertions, so passing them cannot certify numerical consistency. Extend the current suite with independent reference calculations and end-to-end scientific fixtures rather than replacing it. Browser checks used as release gates should fail when required services are unavailable instead of treating a skipped suite as proof of success.

## Verification performed for this report

- Inspected scientific calculations, catalog import and hydration, semantic registry, search, inspection/comparison, observing, sky projection, sharing/export, tile loading, documentation, and CI at the commit above.
- Ran existing Python tests with the project virtual environment: `python -m unittest tests.scientific_trust_guardrail_test tests.ngc_ic_distance_guardrail_test tests.observe_contract_test tests.erosita_dr2_catalog_test tests.sdss_spiders_dr20_catalog_test` — **26 passed**.
- Ran `npm run test:helpers`, `npm run test:sky-projection`, and `npm run test:small-body-propagation` — **all passed**.
- Executed isolated project-module probes for null coordinates, reference-shell comparisons, unknown-radius ratios, and SPIDERS summaries; outputs are recorded in findings 2, 4, and 5. A temporary TypeScript loader and minimal browser globals enabled the probes without modifying application code.
- Compared the fixed catalog transform with the installed Skyfield frame rotation using built-in timescale data; the orientation difference is recorded in finding 1. No upstream ephemeris download was needed for that probe.
- Consulted primary astronomy/tool documentation linked next to the relevant recommendations. Did not run a production browser audit, full build, full test suite, or bulk catalog download; this is a report-only change.

Passing existing tests is evidence about those tests, not evidence that the identified issues are fixed. The recommended acceptance checks are future work.
