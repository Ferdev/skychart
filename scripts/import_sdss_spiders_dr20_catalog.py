#!/usr/bin/env python3
"""Import the SDSS-V DR20 SPIDERS eROSITA DL1 catalog into PostgreSQL.

Streams the public DR20 SPIDERS Data Level 1 allepoch catalog (eROSITA X-ray
targets followed up with SDSS-V/BOSS optical spectroscopy) into the
catalog_sdss_spiders_dr20_objects table so the sources participate in search,
nearest-object selection, and the static point-tile build. Run on the
application host (or a workstation with DATABASE_URL pointing at it), never as
part of the Phoenix release.

Distance semantics: rows adopt the BOSS spectroscopic redshift when
sdss_zwarning == 0 and the value is physical (position model
catalog_inferred_spectroscopic_redshift_comoving). Every other row (stars,
failed redshifts) goes to the explicit reference shell (position model
catalog_sky_position_reference_shell, facts.distance_unknown = true).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from catalog_pg_import import (
    COPY_COLUMNS,
    POSITION_MODEL_REFERENCE_SHELL,
    POSITION_MODEL_SPECTROSCOPIC_COMOVING,
    REFERENCE_SHELL_LY,
    REFERENCE_SHELL_PC,
    comoving_distance_grid,
    copy_process,
    cosmology_metadata,
    delete_group_rows,
    ensure_downloaded,
    existing_group_count,
    finite_float,
    pg_array,
    projected_position,
    reject_none,
    require_fitsio,
    require_numpy,
    utc_now,
    valid_redshift,
    xray_flux_pseudo_magnitude,
)

DL1_ALLEPOCH_URL = "https://data.sdss.org/sas/dr20/vac/mos/DL1_SDSS_eROSITA/v1_1_0/DL1_spec_SDSSV_eROSITA_eRASS3_allepoch-v1_1_0.fits"
VAC_PAGE_URL = "https://www.sdss.org/dr20/data_access/value-added-catalogs/?vac_id=10033"
REFERENCE_URL = "https://arxiv.org/abs/2607.26149"

TABLE = "catalog_sdss_spiders_dr20_objects"
GROUP = "sdss_spiders_dr20"
SOURCE_TYPE = "sdss_spiders_dr20_dl1"

MIN_EXPECTED_RECORDS = 250_000
MAX_EXPECTED_RECORDS = 300_000
DL1_MIN_BYTES = 90_000_000
DL1_MAX_BYTES = 130_000_000

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "sources" / "sdss_spiders_dr20"

DL1_COLUMNS = [
    "ero_detuid",
    "sdss_catalogid",
    "sdss_field",
    "sdss_mjd",
    "sdss_objtype",
    "sdss_z",
    "sdss_z_err",
    "sdss_zwarning",
    "sdss_sn_median_all",
    "sdss_class",
    "sdss_subclass",
    "sdss_nspec",
    "gaia_g",
    "ero_ra",
    "ero_dec",
    "ero_flux",
    "ero_det_like",
]

OBJECT_TYPE_BY_SDSS_CLASS = {
    "QSO": "quasar",
    "GALAXY": "galaxy",
    "STAR": "star",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import the SDSS-V DR20 SPIDERS eROSITA DL1 allepoch catalog into the catalog semantic index."
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Download cache directory.")
    parser.add_argument("--limit", type=int, default=None, help="Import at most N catalog rows (smoke tests).")
    parser.add_argument("--keep-existing", action="store_true", help="Do not delete existing rows for the group first.")
    parser.add_argument(
        "--skip-if-existing-at-least",
        type=int,
        default=None,
        help="Skip the import when the group already holds at least this many rows.",
    )
    return parser.parse_args()


def text_value(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace").strip()
    return str(value).strip()


def build_object_row(
    record: dict[str, Any],
    *,
    now: str,
    now_z: str,
    distance_mpc_for_z,
) -> list[Any] | None:
    """Build one COPY row from plain Python values (pure, unit-testable)."""
    catalogid = text_value(record.get("sdss_catalogid") or "")
    ra_deg = finite_float(record.get("ero_ra"))
    dec_deg = finite_float(record.get("ero_dec"))
    if not catalogid or ra_deg is None or dec_deg is None:
        return None
    if not (0.0 <= ra_deg < 360.0) or not (-90.0 <= dec_deg <= 90.0):
        return None

    sdss_class = text_value(record.get("sdss_class") or "").upper()
    object_type = OBJECT_TYPE_BY_SDSS_CLASS.get(sdss_class, "xray_source")

    redshift = finite_float(record.get("sdss_z"))
    redshift_err = finite_float(record.get("sdss_z_err"))
    zwarning = record.get("sdss_zwarning")
    zwarning = int(zwarning) if zwarning is not None and str(zwarning) != "" else None
    if zwarning == 0 and valid_redshift(redshift):
        distance_pc = distance_mpc_for_z(redshift) * 1.0e6
        position_model = POSITION_MODEL_SPECTROSCOPIC_COMOVING
        distance_unknown = False
    else:
        distance_pc = REFERENCE_SHELL_PC
        position_model = POSITION_MODEL_REFERENCE_SHELL
        distance_unknown = True
        redshift = None
        redshift_err = None

    position = projected_position(ra_deg, dec_deg, distance_pc)
    flux = finite_float(record.get("ero_flux"))
    pseudo_magnitude = xray_flux_pseudo_magnitude(flux)

    ero_detuid = text_value(record.get("ero_detuid") or "")
    key = f"sdss-spiders-dr20-{catalogid}"
    name = f"SPIDERS DR20 {catalogid}"
    aliases = sorted({name, ero_detuid} - {""})
    search_text = " ".join(
        [
            key,
            name,
            catalogid,
            ero_detuid,
            GROUP,
            object_type.replace("_", " "),
            "spiders",
            "sdss",
            "dr20",
            "erosita",
            "x-ray",
        ]
    ).lower()

    facts = reject_none(
        {
            "redshift": redshift,
            "redshift_err": redshift_err,
            "redshift_kind": "sdss_boss_spectroscopic" if redshift is not None else None,
            "sdss_zwarning": zwarning,
            "sdss_class": sdss_class or None,
            "sdss_subclass": text_value(record.get("sdss_subclass") or "") or None,
            "sdss_objtype": text_value(record.get("sdss_objtype") or "") or None,
            "sdss_sn_median_all": finite_float(record.get("sdss_sn_median_all")),
            "sdss_nspec": finite_float(record.get("sdss_nspec")),
            "sdss_field": finite_float(record.get("sdss_field")),
            "sdss_mjd": finite_float(record.get("sdss_mjd")),
            "gaia_g_mag": finite_float(record.get("gaia_g")),
            "xray_flux_erg_s_cm2": flux,
            "xray_det_like": finite_float(record.get("ero_det_like")),
            "distance_unknown": distance_unknown or None,
            "display_shell_ly": REFERENCE_SHELL_LY if distance_unknown else None,
            "display_shell_note": (
                "No usable spectroscopic redshift; drawn on a fixed reference shell. The shell radius is a display convention, not a measurement."
                if distance_unknown
                else None
            ),
            "display_magnitude_kind": "xray_flux_pseudo_magnitude" if pseudo_magnitude is not None else None,
            "cosmology": cosmology_metadata() if not distance_unknown else None,
            "why_interesting": "eROSITA X-ray target with SDSS-V/BOSS optical spectroscopy from the DR20 SPIDERS (Black Hole Mapper) DL1 catalog.",
        }
    )
    source = {
        "catalog": GROUP,
        "source": "SDSS-V DR20 SPIDERS DL1 allepoch catalog v1.1.0 (DL1_SDSS_eROSITA VAC)",
        "catalog_url": DL1_ALLEPOCH_URL,
        "vac_page_url": VAC_PAGE_URL,
        "reference_url": REFERENCE_URL,
        "generated_at_utc": now_z,
        "data_terms": "SDSS open data; cite the SDSS DR20 paper and the SPIDERS DL1 VAC (Aydar, Merloni, Dwelly et al.).",
        "selection": "eROSITA-detected point-like X-ray sources followed up with SDSS-V/BOSS spectroscopy (allepoch stack)",
    }
    external_ids = reject_none(
        {
            "sdss_catalogid": catalogid,
            "erosita_detuid": ero_detuid or None,
        }
    )

    return [
        str(uuid.uuid4()),
        key,
        name,
        object_type,
        GROUP,
        SOURCE_TYPE,
        position_model,
        None,
        None,
        None,
        ra_deg,
        dec_deg,
        distance_pc,
        position["distance_ly"],
        position["x_au"],
        position["y_au"],
        position["z_au"],
        position["x_km"],
        position["y_km"],
        position["z_km"],
        pseudo_magnitude,
        None,
        search_text,
        pg_array(aliases),
        json.dumps(external_ids, separators=(",", ":")),
        json.dumps(facts, separators=(",", ":")),
        json.dumps(source, separators=(",", ":")),
        key,
        catalogid,
        None,
        None,
        None,
        None,
        None,
        now,
        now,
    ]


def main() -> None:
    args = parse_args()

    if args.skip_if_existing_at_least is not None:
        current = existing_group_count(TABLE, GROUP)
        if current >= args.skip_if_existing_at_least:
            print(f"Skipping SPIDERS DR20: existing row count {current:,} >= {args.skip_if_existing_at_least:,}.", flush=True)
            return
        print(f"Importing SPIDERS DR20: existing row count {current:,} < {args.skip_if_existing_at_least:,}.", flush=True)

    fitsio = require_fitsio()
    np = require_numpy()

    dl1_path = ensure_downloaded(
        DL1_ALLEPOCH_URL,
        args.data_dir / "DL1_spec_SDSSV_eROSITA_eRASS3_allepoch-v1_1_0.fits",
        min_bytes=DL1_MIN_BYTES,
        max_bytes=DL1_MAX_BYTES,
    )

    with fitsio.FITS(str(dl1_path)) as fits:
        table = fits[1]
        available = set(table.get_colnames())
        missing = sorted(set(DL1_COLUMNS) - available)
        if missing:
            raise RuntimeError(f"{dl1_path.name} is missing expected columns: {', '.join(missing)}")
        total_rows = table.get_nrows()
        columns = {column: table.read_column(column) for column in DL1_COLUMNS}

    if not MIN_EXPECTED_RECORDS <= total_rows <= MAX_EXPECTED_RECORDS:
        raise RuntimeError(
            f"DL1 allepoch row count {total_rows:,} outside the expected band "
            f"[{MIN_EXPECTED_RECORDS:,}, {MAX_EXPECTED_RECORDS:,}]."
        )

    z_grid, distance_grid = comoving_distance_grid(np)

    def distance_mpc_for_z(redshift: float) -> float:
        return float(np.interp(redshift, z_grid, distance_grid))

    if not args.keep_existing:
        print(f"Deleting existing {GROUP} rows before import.", flush=True)
        delete_group_rows(TABLE, [GROUP])

    now, now_z = utc_now()
    process = copy_process(TABLE, COPY_COLUMNS)
    assert process.stdin is not None
    writer = csv.writer(process.stdin, lineterminator="\n")

    imported = 0
    with_redshift = 0
    limit = args.limit if args.limit else total_rows
    try:
        for index in range(min(limit, total_rows)):
            record = {column: columns[column][index] for column in DL1_COLUMNS}
            row = build_object_row(record, now=now, now_z=now_z, distance_mpc_for_z=distance_mpc_for_z)
            if row is None:
                continue
            writer.writerow(row)
            imported += 1
            if row[6] == POSITION_MODEL_SPECTROSCOPIC_COMOVING:
                with_redshift += 1
            if imported % 50_000 == 0:
                print(f"Imported {imported:,} SPIDERS DR20 rows...", flush=True)
    except BrokenPipeError:
        pass
    finally:
        process.stdin.close()

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"psql COPY failed with exit code {return_code}")

    print(f"Imported {imported:,} SPIDERS DR20 rows ({with_redshift:,} with spectroscopic redshift).", flush=True)


if __name__ == "__main__":
    main()
