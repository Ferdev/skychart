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

Other generated snapshots identify their originating archives and source URLs
inside each JSON file. The `/about` page and
[`docs/scientific-methodology.md`](docs/scientific-methodology.md) provide the
human-readable acknowledgments and methodological caveats.
