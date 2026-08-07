#!/usr/bin/env python3
"""Import the eROSITA-DE DR2 (eRASS:3) X-ray catalogs into PostgreSQL.

Streams the public eRASS:3 main catalog (point-like and extended sources) and
its Legacy Survey DR10 counterpart catalog into the catalog_erosita_dr2_objects
table so the sources participate in search, nearest-object selection, and the
static point-tile build. Run on the application host (or a workstation with
DATABASE_URL pointing at it), never as part of the Phoenix release.

Selection follows Ramos-Ceja et al. 2026 (DR2 paper, Table 3): the released
main catalog holds DET_LIKE_0 >= 6 sources; point-like sources have
EXT_LIKE = 0 and extended sources have EXT_LIKE > 0 (63,796 rows).

Distance semantics: rows adopt the SIMBAD-compiled redshift shipped with the
LS10 counterpart catalog when usable (position model
catalog_inferred_compiled_redshift_comoving; reliability varies and is flagged
in facts). Rows without a usable redshift are placed on an explicit reference
shell (position model catalog_sky_position_reference_shell) with
facts.distance_unknown = true. No distance is ever invented silently.

The FLAG_SP_* columns are kept as facts only. They mark an elevated spurious
detection risk near known supernova remnants, star clusters, local-group
galaxies, and galaxy clusters — they are not object classifications.
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
    POSITION_MODEL_COMPILED_COMOVING,
    POSITION_MODEL_REFERENCE_SHELL,
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
    slugify,
    utc_now,
    valid_redshift,
    xray_flux_pseudo_magnitude,
)

MAIN_CATALOG_URL = "https://erosita.mpe.mpg.de/dr2/AllSkySurveyData_dr2/Catalogues_dr2/RamosM_DR2/eRASS3_Main_v1.3.fits"
LS10_COUNTERPARTS_URL = "https://erosita.mpe.mpg.de/dr2/AllSkySurveyData_dr2/Catalogues_dr2/RamosM_DR2/eRASSc3_Main_LS10_Public_27Jul2026.fits.gz"
CATALOG_PAGE_URL = "https://erosita.mpe.mpg.de/dr2/AllSkySurveyData_dr2/Catalogues_dr2/"
REFERENCE_URL = "https://arxiv.org/abs/2607.27772"

TABLE = "catalog_erosita_dr2_objects"
POINT_GROUP = "erosita_dr2_xray"
EXTENDED_GROUP = "erosita_dr2_extended"
POINT_SOURCE_TYPE = "erosita_dr2_main"
EXTENDED_SOURCE_TYPE = "erosita_dr2_extended"

MIN_EXPECTED_MAIN_RECORDS = 1_900_000
MAX_EXPECTED_MAIN_RECORDS = 2_100_000
MIN_EXPECTED_COUNTERPART_RECORDS = 1_400_000
MAX_EXPECTED_COUNTERPART_RECORDS = 1_800_000
# Ramos-Ceja et al. 2026: exactly 63,796 extended sources (EXT_LIKE > 0).
MIN_EXPECTED_EXTENDED_RECORDS = 55_000
MAX_EXPECTED_EXTENDED_RECORDS = 75_000

MAIN_MIN_BYTES = 1_900_000_000
MAIN_MAX_BYTES = 2_400_000_000
LS10_MIN_BYTES = 900_000_000
LS10_MAX_BYTES = 1_300_000_000

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "sources" / "erosita_dr2"

MAIN_COLUMNS = [
    "IAUNAME",
    "DETUID",
    "RA",
    "DEC",
    "RADEC_ERR",
    "DET_LIKE_0",
    "ML_FLUX_1",
    "ML_RATE_1",
    "ML_EXP_1",
    "EXT",
    "EXT_LIKE",
    "FLAG_SP_SNR",
    "FLAG_SP_SCL",
    "FLAG_SP_LGA",
    "FLAG_SP_GC_CONS",
]

LS10_COLUMNS = [
    "DETUID",
    "redshift_simbad",
    "redshift_err_simbad",
    "class_gal_exgal",
    "class_jetted",
    "LS10_TYPE",
    "GDR3_phot_g_mean_mag",
    "main_id_simbad",
    "morph_type_simbad",
]

SIMBAD_REDSHIFT_CAVEAT = (
    "Redshift compiled from SIMBAD via the eROSITA-DE DR2 LS10 counterpart "
    "catalog; the source documentation warns these values are not always reliable."
)

FLAG_DESCRIPTIONS = {
    "flag_sp_snr": "Near a known supernova remnant; elevated spurious-detection risk (DR2 flag, not a classification).",
    "flag_sp_scl": "Near a known star cluster; elevated spurious-detection risk (DR2 flag, not a classification).",
    "flag_sp_lga": "Near a known local-group galaxy; elevated spurious-detection risk (DR2 flag, not a classification).",
    "flag_sp_gc_cons": "Near a known galaxy cluster; elevated spurious-detection risk (DR2 flag, not a classification).",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import the eROSITA-DE DR2 eRASS:3 catalogs into the catalog semantic index."
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Download cache directory.")
    parser.add_argument("--limit", type=int, default=None, help="Import at most N main-catalog rows (smoke tests).")
    parser.add_argument("--keep-existing", action="store_true", help="Do not delete existing rows for the DR2 groups first.")
    parser.add_argument(
        "--skip-if-existing-at-least",
        type=int,
        default=None,
        help="Skip the import when the DR2 groups already hold at least this many rows.",
    )
    return parser.parse_args()


def text_value(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace").strip()
    return str(value).strip()


def int_code(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def iauname_key(iauname: str) -> str:
    """Key slug for an eROSITA IAU name.

    The declination sign must survive slugification: the catalog contains
    distinct sources whose names differ only by the sign (for example
    3eRASS J054951.9+212258 vs 3eRASS J054951.9-212258).
    """
    return slugify(iauname.replace("+", "p").replace("-", "m"))


def classify(ext_like: float | None) -> tuple[str, str, str]:
    """Return (catalog_group, source_type, object_type) for one source.

    DR2 convention (Ramos-Ceja et al. 2026, Table 3): EXT_LIKE = 0 point-like,
    EXT_LIKE > 0 extended. The catalog does not classify extended sources, so
    both map to the generic X-ray object types.
    """
    if ext_like is None or ext_like <= 0.0:
        return POINT_GROUP, POINT_SOURCE_TYPE, "xray_source"
    return EXTENDED_GROUP, EXTENDED_SOURCE_TYPE, "xray_extended"


def build_object_row(
    record: dict[str, Any],
    *,
    now: str,
    now_z: str,
    distance_mpc_for_z,
    key_suffix: str | None = None,
) -> list[Any] | None:
    """Build one COPY row from plain Python values (pure, unit-testable)."""
    iauname = text_value(record.get("iauname") or "")
    detuid = text_value(record.get("detuid") or "")
    ra_deg = finite_float(record.get("ra_deg"))
    dec_deg = finite_float(record.get("dec_deg"))
    if not iauname or not detuid or ra_deg is None or dec_deg is None:
        return None
    if not (0.0 <= ra_deg < 360.0) or not (-90.0 <= dec_deg <= 90.0):
        return None

    flux = finite_float(record.get("flux_erg_s_cm2"))
    ext_like = finite_float(record.get("ext_like"))
    group, source_type, object_type = classify(ext_like)

    redshift = finite_float(record.get("redshift"))
    redshift_err = finite_float(record.get("redshift_err"))
    if valid_redshift(redshift):
        distance_pc = distance_mpc_for_z(redshift) * 1.0e6
        position_model = POSITION_MODEL_COMPILED_COMOVING
        distance_unknown = False
    else:
        distance_pc = REFERENCE_SHELL_PC
        position_model = POSITION_MODEL_REFERENCE_SHELL
        distance_unknown = True
        redshift = None
        redshift_err = None

    position = projected_position(ra_deg, dec_deg, distance_pc)
    pseudo_magnitude = xray_flux_pseudo_magnitude(flux)

    ext_arcsec = finite_float(record.get("ext_arcsec"))
    extent_ly = None
    if object_type == "xray_extended" and ext_arcsec is not None and not distance_unknown:
        extent_pc = ext_arcsec * distance_pc / 206_264.80624709636
        extent_ly = extent_pc * 3.261563777

    key = f"erosita-dr2-{iauname_key(iauname)}"
    if key_suffix:
        key = f"{key}-{key_suffix}"
    compact_name = iauname.replace(" ", "")
    aliases = sorted({iauname, compact_name})
    search_text = " ".join(
        [key, iauname, compact_name, group, object_type.replace("_", " "), "erosita", "erass3", "dr2", "x-ray"]
    ).lower()

    flag_facts = {
        key_: description
        for key_, description in FLAG_DESCRIPTIONS.items()
        if bool(record.get(key_))
    }
    facts = reject_none(
        {
            "det_like_0": finite_float(record.get("det_like")),
            "xray_flux_erg_s_cm2": flux,
            "xray_flux_band_kev": "0.2-2.3",
            "xray_rate_ct_s": finite_float(record.get("rate")),
            "xray_exposure_s": finite_float(record.get("exposure_s")),
            "radec_err_arcsec": finite_float(record.get("radec_err_arcsec")),
            "ext_arcsec": ext_arcsec,
            "ext_like": ext_like,
            "extent_ly": extent_ly,
            "redshift": redshift,
            "redshift_err": redshift_err,
            "redshift_kind": "simbad_compiled" if redshift is not None else None,
            "redshift_caveat": SIMBAD_REDSHIFT_CAVEAT if redshift is not None else None,
            "distance_unknown": distance_unknown or None,
            "display_shell_ly": REFERENCE_SHELL_LY if distance_unknown else None,
            "display_shell_note": (
                "No usable redshift; drawn on a fixed reference shell. The shell radius is a display convention, not a measurement."
                if distance_unknown
                else None
            ),
            "display_magnitude_kind": "xray_flux_pseudo_magnitude" if pseudo_magnitude is not None else None,
            "ls10_counterpart_type": text_value(record.get("ls10_type") or "") or None,
            "class_gal_exgal_code": int_code(record.get("class_gal_exgal")),
            "class_jetted_code": int_code(record.get("class_jetted")),
            "gdr3_phot_g_mean_mag": finite_float(record.get("gdr3_g_mag")),
            "simbad_main_id": text_value(record.get("main_id_simbad") or "") or None,
            "simbad_morph_type": text_value(record.get("morph_type_simbad") or "") or None,
            "observation_window": "eRASS1-3, 2019-12-12 to 2021-06-16",
            "sky_coverage": "eROSITA-DE western Galactic hemisphere",
            "cosmology": cosmology_metadata() if not distance_unknown else None,
            "why_interesting": "X-ray source from the eROSITA-DE DR2 eRASS:3 catalog, the deepest public all-sky X-ray source inventory.",
            **flag_facts,
        }
    )
    source = {
        "catalog": group,
        "source": "eROSITA-DE Data Release 2 eRASS:3 main catalog v1.3 + LS10 counterparts",
        "main_catalog_url": MAIN_CATALOG_URL,
        "counterparts_url": LS10_COUNTERPARTS_URL,
        "catalog_page_url": CATALOG_PAGE_URL,
        "reference_url": REFERENCE_URL,
        "generated_at_utc": now_z,
        "data_terms": "Acknowledge the eROSITA-DE DR2 catalogue release and Ramos-Ceja et al. 2026 when using these data.",
        "selection": {
            "main_catalog": "eSASS 0.2-2.3 keV, DET_LIKE_0 >= 6",
            "point_like": "EXT_LIKE = 0",
            "extended": "EXT_LIKE > 0",
        },
    }
    external_ids = reject_none(
        {
            "erosita_dr2_detuid": detuid,
            "erosita_iauname": iauname,
            "simbad_main_id": text_value(record.get("main_id_simbad") or "") or None,
        }
    )

    return [
        str(uuid.uuid4()),
        key,
        iauname,
        object_type,
        group,
        source_type,
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
        detuid,
        None,
        None,
        None,
        None,
        None,
        now,
        now,
    ]


def read_columns(fitsio, path: Path, columns: list[str]) -> dict[str, Any]:
    with fitsio.FITS(str(path)) as fits:
        table = fits[1]
        available = set(table.get_colnames())
        missing = sorted(set(columns) - available)
        if missing:
            raise RuntimeError(f"{path.name} is missing expected columns: {', '.join(missing)}")
        rows = table.get_nrows()
        return {column: table.read_column(column) for column in columns} | {"__nrows__": rows}


def main() -> None:
    args = parse_args()

    if args.skip_if_existing_at_least is not None:
        current = existing_group_count(TABLE, POINT_GROUP) + existing_group_count(TABLE, EXTENDED_GROUP)
        if current >= args.skip_if_existing_at_least:
            print(f"Skipping eROSITA DR2: existing row count {current:,} >= {args.skip_if_existing_at_least:,}.", flush=True)
            return
        print(f"Importing eROSITA DR2: existing row count {current:,} < {args.skip_if_existing_at_least:,}.", flush=True)

    fitsio = require_fitsio()
    np = require_numpy()

    main_path = ensure_downloaded(
        MAIN_CATALOG_URL, args.data_dir / "eRASS3_Main_v1.3.fits", min_bytes=MAIN_MIN_BYTES, max_bytes=MAIN_MAX_BYTES
    )
    ls10_path = ensure_downloaded(
        LS10_COUNTERPARTS_URL,
        args.data_dir / "eRASSc3_Main_LS10_Public_27Jul2026.fits.gz",
        min_bytes=LS10_MIN_BYTES,
        max_bytes=LS10_MAX_BYTES,
    )

    main_data = read_columns(fitsio, main_path, MAIN_COLUMNS)
    total_rows = main_data["__nrows__"]
    if not MIN_EXPECTED_MAIN_RECORDS <= total_rows <= MAX_EXPECTED_MAIN_RECORDS:
        raise RuntimeError(
            f"Main catalog row count {total_rows:,} outside the expected band "
            f"[{MIN_EXPECTED_MAIN_RECORDS:,}, {MAX_EXPECTED_MAIN_RECORDS:,}]."
        )

    ls10_data = read_columns(fitsio, ls10_path, LS10_COLUMNS)
    counterpart_rows = ls10_data["__nrows__"]
    if not MIN_EXPECTED_COUNTERPART_RECORDS <= counterpart_rows <= MAX_EXPECTED_COUNTERPART_RECORDS:
        raise RuntimeError(
            f"LS10 counterpart row count {counterpart_rows:,} outside the expected band "
            f"[{MIN_EXPECTED_COUNTERPART_RECORDS:,}, {MAX_EXPECTED_COUNTERPART_RECORDS:,}]."
        )

    print(f"Main catalog: {total_rows:,} rows; LS10 counterparts: {counterpart_rows:,} rows.", flush=True)

    counterparts: dict[str, int] = {}
    ls10_detuid = ls10_data["DETUID"]
    for index in range(counterpart_rows):
        detuid = text_value(ls10_detuid[index])
        if detuid:
            counterparts[detuid] = index
    print(f"Indexed {len(counterparts):,} counterpart records by DETUID.", flush=True)

    z_grid, distance_grid = comoving_distance_grid(np)

    def distance_mpc_for_z(redshift: float) -> float:
        return float(np.interp(redshift, z_grid, distance_grid))

    def counterpart_value(column: str, row_index: int | None) -> Any:
        if row_index is None:
            return None
        return ls10_data[column][row_index]

    if not args.keep_existing:
        print(f"Deleting existing {POINT_GROUP}/{EXTENDED_GROUP} rows before import.", flush=True)
        delete_group_rows(TABLE, [POINT_GROUP, EXTENDED_GROUP])

    now, now_z = utc_now()
    process = copy_process(TABLE, COPY_COLUMNS)
    assert process.stdin is not None
    writer = csv.writer(process.stdin, lineterminator="\n")

    imported = 0
    extended = 0
    with_redshift = 0
    limit = args.limit if args.limit else total_rows
    columns = {column: main_data[column] for column in MAIN_COLUMNS}

    # One source in eRASS:3 (3eRASS J090206.8-403318) appears twice; duplicate
    # IAU names get a DETUID-based key suffix to keep keys unique and stable.
    seen_iaunames: set[str] = set()
    duplicate_iaunames: set[str] = set()
    for index in range(min(limit, total_rows)):
        name = text_value(columns["IAUNAME"][index])
        if name in seen_iaunames:
            duplicate_iaunames.add(name)
        seen_iaunames.add(name)
    if duplicate_iaunames:
        print(f"Found {len(duplicate_iaunames):,} duplicate IAU names; disambiguating keys by DETUID.", flush=True)

    try:
        for index in range(min(limit, total_rows)):
            detuid = text_value(columns["DETUID"][index])
            iauname = text_value(columns["IAUNAME"][index])
            ls10_index = counterparts.get(detuid)
            record = {
                "iauname": iauname,
                "detuid": detuid,
                "ra_deg": columns["RA"][index],
                "dec_deg": columns["DEC"][index],
                "radec_err_arcsec": columns["RADEC_ERR"][index],
                "det_like": columns["DET_LIKE_0"][index],
                "flux_erg_s_cm2": columns["ML_FLUX_1"][index],
                "rate": columns["ML_RATE_1"][index],
                "exposure_s": columns["ML_EXP_1"][index],
                "ext_arcsec": columns["EXT"][index],
                "ext_like": columns["EXT_LIKE"][index],
                "flag_sp_snr": bool(columns["FLAG_SP_SNR"][index]),
                "flag_sp_scl": bool(columns["FLAG_SP_SCL"][index]),
                "flag_sp_lga": bool(columns["FLAG_SP_LGA"][index]),
                "flag_sp_gc_cons": bool(columns["FLAG_SP_GC_CONS"][index]),
                "redshift": counterpart_value("redshift_simbad", ls10_index),
                "redshift_err": counterpart_value("redshift_err_simbad", ls10_index),
                "ls10_type": counterpart_value("LS10_TYPE", ls10_index),
                "class_gal_exgal": counterpart_value("class_gal_exgal", ls10_index),
                "class_jetted": counterpart_value("class_jetted", ls10_index),
                "gdr3_g_mag": counterpart_value("GDR3_phot_g_mean_mag", ls10_index),
                "main_id_simbad": counterpart_value("main_id_simbad", ls10_index),
                "morph_type_simbad": counterpart_value("morph_type_simbad", ls10_index),
            }
            row = build_object_row(
                record,
                now=now,
                now_z=now_z,
                distance_mpc_for_z=distance_mpc_for_z,
                key_suffix=slugify(detuid) if iauname in duplicate_iaunames else None,
            )
            if row is None:
                continue
            writer.writerow(row)
            imported += 1
            if row[4] == EXTENDED_GROUP:
                extended += 1
            if row[6] == POSITION_MODEL_COMPILED_COMOVING:
                with_redshift += 1
            if imported % 200_000 == 0:
                print(f"Imported {imported:,} eROSITA DR2 rows...", flush=True)
    except BrokenPipeError:
        pass
    finally:
        process.stdin.close()

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"psql COPY failed with exit code {return_code}")

    if args.limit is None and not MIN_EXPECTED_EXTENDED_RECORDS <= extended <= MAX_EXPECTED_EXTENDED_RECORDS:
        raise RuntimeError(
            f"Extended-source count {extended:,} outside the expected band "
            f"[{MIN_EXPECTED_EXTENDED_RECORDS:,}, {MAX_EXPECTED_EXTENDED_RECORDS:,}]; "
            "verify the EXT_LIKE selection against the DR2 documentation."
        )

    print(
        f"Imported {imported:,} eROSITA DR2 rows ({extended:,} extended, {with_redshift:,} with compiled redshift).",
        flush=True,
    )


if __name__ == "__main__":
    main()
