#!/usr/bin/env python3
"""Shared helpers for direct-to-Postgres bulk catalog imports.

Used by import scripts that stream large survey catalogs (eROSITA-DE DR2,
SDSS-V DR20 SPIDERS) into source-specific catalog tables, mirroring the
Gaia bulk importer pattern. Distances derived from redshifts use the same
flat-LambdaCDM cosmology as the DESI/Quaia bulk pipelines.
"""

from __future__ import annotations

import math
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

AU_KM = 149_597_870.700
PARSEC_AU = 206_264.80624709636
LIGHT_YEAR_KM = 9_460_730_472_580.8
LY_PER_PC = 3.261563777
OBLIQUITY_DEG = 23.4392911

# Flat-LambdaCDM cosmology shared with the DESI/Quaia bulk pipelines.
C_KM_S = 299_792.458
H0_KM_S_MPC = 67.66
OMEGA_M = 0.30966
OMEGA_LAMBDA = 1.0 - OMEGA_M
MIN_REDSHIFT = 0.0001
MAX_REDSHIFT = 20.0

# Sources without any usable redshift are drawn on an explicit display shell.
# The shell radius is a rendering convention, never a distance measurement.
REFERENCE_SHELL_LY = 1.0e9
REFERENCE_SHELL_PC = REFERENCE_SHELL_LY / LY_PER_PC

# Physical column list of the per-source catalog tables (see the
# create_source_specific_catalog_tables migration). ``source_payload`` and
# ``projected_payload`` are omitted so their NOT NULL '{}' defaults apply.
COPY_COLUMNS = [
    "id",
    "key",
    "name",
    "object_type",
    "catalog_group",
    "source_type",
    "position_model",
    "parent_key",
    "color",
    "radius_km",
    "ra_deg",
    "dec_deg",
    "distance_pc",
    "distance_ly",
    "x_au",
    "y_au",
    "z_au",
    "x_km",
    "y_km",
    "z_km",
    "apparent_magnitude",
    "absolute_magnitude",
    "search_text",
    "aliases",
    "external_ids",
    "facts",
    "source",
    "catalog_object_key",
    "source_identifier",
    "source_epoch",
    "position_epoch",
    "pmra_mas_yr",
    "pmdec_mas_yr",
    "radial_velocity_km_s",
    "inserted_at",
    "updated_at",
]

POSITION_MODEL_SPECTROSCOPIC_COMOVING = "catalog_inferred_spectroscopic_redshift_comoving"
POSITION_MODEL_COMPILED_COMOVING = "catalog_inferred_compiled_redshift_comoving"
POSITION_MODEL_REFERENCE_SHELL = "catalog_sky_position_reference_shell"


def comoving_distance_grid(np):
    """Redshift/comoving-distance grid identical to the DESI bulk pipeline."""
    z_grid = np.linspace(0.0, 8.0, 400_001, dtype=np.float64)
    inverse_e = 1.0 / np.sqrt(OMEGA_M * (1.0 + z_grid) ** 3 + OMEGA_LAMBDA)
    distance = np.empty_like(z_grid)
    distance[0] = 0.0
    dz = z_grid[1] - z_grid[0]
    distance[1:] = np.cumsum((inverse_e[:-1] + inverse_e[1:]) * 0.5 * dz)
    distance *= C_KM_S / H0_KM_S_MPC
    return z_grid, distance


def comoving_distance_mpc(redshift: float, *, steps: int = 200_000) -> float:
    """Scalar line-of-sight comoving distance in Mpc (stdlib; for tests/tools)."""
    if redshift <= 0:
        return 0.0
    dz = redshift / steps
    total = 0.0
    previous = 1.0  # 1/E(0)
    for index in range(1, steps + 1):
        z = index * dz
        current = 1.0 / math.sqrt(OMEGA_M * (1.0 + z) ** 3 + OMEGA_LAMBDA)
        total += (previous + current) * 0.5 * dz
        previous = current
    return total * C_KM_S / H0_KM_S_MPC


def cosmology_metadata() -> dict[str, Any]:
    return {
        "model": "flat LambdaCDM",
        "distance": "line-of-sight comoving distance",
        "H0_km_s_Mpc": H0_KM_S_MPC,
        "Omega_m": OMEGA_M,
        "Omega_lambda": OMEGA_LAMBDA,
    }


def valid_redshift(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and MIN_REDSHIFT <= value <= MAX_REDSHIFT


def projected_position(ra_deg: float, dec_deg: float, distance_pc: float) -> dict[str, float]:
    """Heliocentric ecliptic Cartesian projection, matching the Gaia importer."""
    distance_au = distance_pc * PARSEC_AU
    ra_rad = math.radians(ra_deg)
    dec_rad = math.radians(dec_deg)
    equatorial_x_au = distance_au * math.cos(dec_rad) * math.cos(ra_rad)
    equatorial_y_au = distance_au * math.cos(dec_rad) * math.sin(ra_rad)
    equatorial_z_au = distance_au * math.sin(dec_rad)
    obliquity_rad = math.radians(OBLIQUITY_DEG)
    x_au = equatorial_x_au
    y_au = equatorial_y_au * math.cos(obliquity_rad) + equatorial_z_au * math.sin(obliquity_rad)
    z_au = -equatorial_y_au * math.sin(obliquity_rad) + equatorial_z_au * math.cos(obliquity_rad)
    return {
        "distance_ly": distance_au * AU_KM / LIGHT_YEAR_KM,
        "x_au": x_au,
        "y_au": y_au,
        "z_au": z_au,
        "x_km": x_au * AU_KM,
        "y_km": y_au * AU_KM,
        "z_km": z_au * AU_KM,
    }


def xray_flux_pseudo_magnitude(flux_erg_s_cm2: float | None) -> float | None:
    """Monotonic flux mapping used only for render/search ordering.

    Not an optical magnitude; stored in apparent_magnitude so brighter X-ray
    sources sample first in static tiles. Flagged in facts via
    display_magnitude_kind. Scaled into the 0..23 band because the SMP3 tile
    encoder clamps magnitudes above 23.3: flux 1e-12 -> 8, each 10x fainter
    adds 3 magnitudes.
    """
    if flux_erg_s_cm2 is None or not math.isfinite(flux_erg_s_cm2) or flux_erg_s_cm2 <= 0:
        return None
    magnitude = 8.0 - 3.0 * (math.log10(max(flux_erg_s_cm2, 1.0e-16)) + 12.0)
    return max(0.0, min(23.0, magnitude))


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def reject_none(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def slugify(value: str) -> str:
    slug = []
    previous_dash = True
    for char in value.strip().lower():
        if char.isalnum():
            slug.append(char)
            previous_dash = False
        elif not previous_dash:
            slug.append("-")
            previous_dash = True
    return "".join(slug).strip("-")


def pg_array(values: list[str]) -> str:
    escaped = []
    for value in values:
        escaped_value = value.replace("\\", "\\\\").replace('"', '\\"')
        escaped.append(f'"{escaped_value}"')
    return "{" + ",".join(escaped) + "}"


def utc_now() -> tuple[str, str]:
    now_dt = datetime.now(timezone.utc).replace(microsecond=0)
    return now_dt.isoformat().replace("+00:00", ""), now_dt.isoformat().replace("+00:00", "Z")


def psql_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PGUSER", "postgres")
    env.setdefault("PGDATABASE", "starsmap_api_dev")
    return env


def psql_base_command() -> list[str]:
    command = ["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"]
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        if database_url.startswith("ecto://"):
            database_url = f"postgresql://{database_url.removeprefix('ecto://')}"
        command.extend(["--dbname", database_url])
    return command


def run_psql(sql: str) -> None:
    subprocess.run([*psql_base_command(), "-c", sql], env=psql_env(), check=True)


def query_psql_scalar(sql: str) -> str:
    result = subprocess.run(
        [*psql_base_command(), "-At", "-c", sql],
        env=psql_env(),
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return result.stdout.strip()


def existing_group_count(table: str, group: str) -> int:
    escaped_group = group.replace("'", "''")
    raw_count = query_psql_scalar(
        f"SELECT COUNT(*) FROM {table} WHERE catalog_group = '{escaped_group}'"
    )
    return int(raw_count or "0")


def copy_process(table: str, columns: list[str]) -> subprocess.Popen[str]:
    column_sql = ", ".join(columns)
    command = f"\\copy {table} ({column_sql}) FROM STDIN WITH (FORMAT csv)"
    return subprocess.Popen(
        [*psql_base_command(), "-c", command],
        env=psql_env(),
        stdin=subprocess.PIPE,
        text=True,
    )


def delete_group_rows(table: str, groups: list[str]) -> None:
    group_sql = ", ".join(f"'{group.replace(chr(39), chr(39) * 2)}'" for group in groups)
    run_psql(f"DELETE FROM {table} WHERE catalog_group IN ({group_sql})")


def require_fitsio():
    try:
        import fitsio
        return fitsio
    except ImportError as error:
        raise SystemExit(
            "Install scripts/erosita_dr2_requirements.txt in an isolated environment first."
        ) from error


def require_numpy():
    try:
        import numpy
        return numpy
    except ImportError as error:
        raise SystemExit(
            "Install scripts/erosita_dr2_requirements.txt in an isolated environment first."
        ) from error


def ensure_downloaded(url: str, path: Path, *, min_bytes: int, max_bytes: int) -> Path:
    if path.exists() and min_bytes <= path.stat().st_size <= max_bytes:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".download")
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=900) as response, temporary.open("wb") as handle:
        downloaded = 0
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            downloaded += len(chunk)
            if downloaded > max_bytes:
                raise RuntimeError(f"{url} exceeded the {max_bytes}-byte download bound")
            handle.write(chunk)
    if downloaded < min_bytes:
        raise RuntimeError(f"{url} returned only {downloaded} bytes; expected at least {min_bytes}")
    temporary.replace(path)
    return path
