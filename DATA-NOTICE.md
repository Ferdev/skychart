# Scientific data notice

The MIT license in this repository covers the Cosmic Atlas source code and
original project materials. It does **not** relicense third-party scientific
catalog records in `data/catalogs/`, generated catalog tiles, or downloaded
ephemeris kernels. Those records retain their upstream provenance, citation
requirements, and applicable terms.

The BASS DR2 black-hole snapshot is a transformed selection from the publicly
released BASS DR2 catalog distributed through CDS/VizieR. BASS DR2 and VizieR
publish the data and citation instructions, but the catalog page does not state
an SPDX-style redistribution license. Accordingly, the snapshot is not offered
under MIT and no ownership claim is made over its upstream measurements. Users
who redistribute it should review the current BASS/VizieR terms and cite:

- Koss et al. (2022), *BASS. XXII. The BASS DR2 AGN Catalog and Data*,
  DOI `10.3847/1538-4365/ac6c05`;
- the VizieR catalog access service, DOI `10.26093/cds/vizier`;
- BASS DR2 catalog `J/ApJS/261/2`, table 9.

The eROSITA-DE DR2 and SDSS-V DR20 SPIDERS rows are imported directly into
PostgreSQL by `scripts/import_erosita_dr2_catalog.py` and
`scripts/import_sdss_spiders_dr20_catalog.py`; no derived snapshot of those
catalogs is committed to this repository. Users who redistribute derived
products should review the upstream terms and cite:

- Ramos-Ceja et al. (2026), *The SRG/eROSITA All-Sky Survey DR2*,
  arXiv `2607.27772`, and acknowledge the eROSITA-DE DR2 catalogue release
  (`https://erosita.mpe.mpg.de/dr2/`);
- the SDSS DR20 paper (arXiv `2607.26149`) and the SPIDERS DL1 value-added
  catalog (`DL1_SDSS_eROSITA` v1.1.0; Aydar, Merloni, Dwelly et al.).

Other generated snapshots identify their originating archives and source URLs
inside each JSON file. The `/about` page and
[`docs/scientific-methodology.md`](docs/scientific-methodology.md) provide the
human-readable acknowledgments and methodological caveats.

Constellation line topology in `src/sky/constellations.ts` follows the
IAU/Sky & Telescope figures created with Alan MacRobert and published by the
IAU under CC BY 4.0, using the Hipparcos transcription maintained by Dominic
Ford at `https://github.com/dcf21/constellation-stick-figures` (accessed
2026-08-26). The IAU standardizes constellation regions; stick-figure line
patterns are a conventional visualization rather than official boundaries.

Selectable DESI DR1 tile points resolve their source coordinates and redshift
at display time from the public `desi_dr1.zpix` and `desi_dr1.photometry`
tables hosted by NSF NOIRLab Astro Data Lab. Those on-demand records are cached
temporarily, are not committed to this repository, and retain the DESI DR1 CC
BY 4.0 license, citation, and acknowledgment requirements.

DESI Legacy Imaging Surveys DR11 cutouts are requested at display time from
the official Legacy Survey Sky Viewer; they are not committed to this
repository or relicensed under MIT. The object inspector credits the survey
and links each cutout back to the DR11 viewer and release documentation. It
also requests DSS2 all-sky context and, only when DR11 fails, a labeled
AllWISE infrared fallback from the CDS/Aladin HiPS image service; those images keep
their upstream terms and attribution.
