from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "skyfield"
CACHE_DIR = ROOT / "data" / "cache"
DEEP_SKY_CATALOG_PATH = ROOT / "data" / "catalogs" / "deep_sky_catalog.json"
EXOPLANET_CATALOG_PATH = ROOT / "data" / "catalogs" / "exoplanet_systems.json"
BRIGHT_STAR_CATALOG_PATH = ROOT / "data" / "catalogs" / "bright_stars.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("ATLAS_API_PORT", "8765"))
AU_KM = 149_597_870.700
PARSEC_AU = 206_264.80624709636
LIGHT_YEAR_KM = 9_460_730_472_580.8
SUN_MU_KM3_S2 = 132_712_440_018.0
SECONDS_PER_DAY = 86_400.0
CACHE_SCHEMA_VERSION = 5
LIVE_TIMESTAMP_BUCKET_SECONDS = 300
EPHEMERIS_SOURCE = (
    "NASA/JPL DE440s ephemeris via Skyfield; NAIF MAR099s satellite SPK; NASA/JPL Horizons vectors; "
    "NASA Exoplanet Archive host-star and confirmed-planet catalog; Hipparcos bright-star catalog via CDS/VizieR; "
    "generated Messier deep-sky catalog snapshot; Phoenix catalog index for Gaia DR3 bulk slices, SIMBAD, and JPL SBDB generated slices"
)
SATELLITE_KERNEL_URLS = {
    "mar099s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/mar099s.bsp",
}
