from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_SOURCE_DOC_URL = "https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html"

AU_KM = 149_597_870.700
PARSEC_AU = 206_264.80624709636
LIGHT_YEAR_KM = 9_460_730_472_580.8
SOLAR_RADIUS_KM = 695_700.0
SOLAR_EFFECTIVE_TEMPERATURE_K = 5772.0
SOLAR_ABSOLUTE_G_MAG = 4.67
OBLIQUITY_DEG = 23.4392911

DEFAULT_GROUP = "gaia_500pc_stars"
TEN_KPC_GROUP = "gaia_10kpc_bright_stars"
DEFAULT_MIN_G_MAG = None
DEFAULT_MAX_G_MAG = 13.0
DEFAULT_MIN_PARALLAX_MAS = 2.0
DEFAULT_MAX_PARALLAX_MAS = 20.0
DEFAULT_MIN_PARALLAX_OVER_ERROR = 5.0

COLUMNS = [
    "source_id",
    "ra",
    "dec",
    "parallax",
    "parallax_over_error",
    "phot_g_mean_mag",
    "bp_rp",
    "pmra",
    "pmdec",
    "radial_velocity",
    "astrometric_params_solved",
]

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
    "inserted_at",
    "updated_at",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stream a large Gaia DR3 slice directly into the Phoenix catalog_objects table."
    )
    parser.add_argument("--group", default=DEFAULT_GROUP, help=f"Catalog group to write. Default: {DEFAULT_GROUP}")
    parser.add_argument(
        "--preset",
        choices=["500pc-g14", "10kpc-g12"],
        help="Import a known safe binned preset. 500pc-g14 imports G<=14 stars between 50 and 500 pc; 10kpc-g12 imports bright G<=12 stars between 500 pc and 10 kpc.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional TOP N limit for smoke tests.")
    parser.add_argument("--min-g-mag", type=float, default=DEFAULT_MIN_G_MAG)
    parser.add_argument("--max-g-mag", type=float, default=DEFAULT_MAX_G_MAG)
    parser.add_argument("--min-parallax-mas", type=float, default=DEFAULT_MIN_PARALLAX_MAS)
    parser.add_argument("--max-parallax-mas", type=float, default=DEFAULT_MAX_PARALLAX_MAS)
    parser.add_argument("--min-parallax-over-error", type=float, default=DEFAULT_MIN_PARALLAX_OVER_ERROR)
    parser.add_argument("--skip-count", action="store_true", help="Skip the Gaia COUNT(*) preflight.")
    parser.add_argument("--keep-existing", action="store_true", help="Do not delete the target catalog group before COPY.")
    return parser.parse_args()


def gaia_query(args: argparse.Namespace, *, count: bool = False) -> str:
    if count:
        select = "SELECT COUNT(*) AS n"
    else:
        top = f"TOP {args.limit} " if args.limit else ""
        select = f"SELECT {top}{', '.join(COLUMNS)}"

    min_g_filter = "" if args.min_g_mag is None else f"  AND phot_g_mean_mag > {args.min_g_mag}\n"

    return f"""
{select}
FROM gaiadr3.gaia_source
WHERE parallax >= {args.min_parallax_mas}
  AND parallax < {args.max_parallax_mas}
  AND parallax_over_error >= {args.min_parallax_over_error}
  AND phot_g_mean_mag IS NOT NULL
{min_g_filter.rstrip()}
  AND phot_g_mean_mag <= {args.max_g_mag}
""".strip()


def fetch_tap_csv(query: str, *, maxrec: int | None = None):
    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "csv",
        "QUERY": query,
    }
    if maxrec:
        params["MAXREC"] = str(maxrec)

    request = Request(
        f"{GAIA_TAP_URL}?{urlencode(params)}",
        headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"},
    )
    return urlopen(request, timeout=900)


def fetch_count(args: argparse.Namespace) -> int:
    with fetch_tap_csv(gaia_query(args, count=True), maxrec=1) as response:
        reader = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8", newline=""))
        row = next(reader)
    return int(float(row["n"]))


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def finite_int(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def color_temperature_from_bp_rp(bp_rp: float | None) -> float | None:
    if bp_rp is None or bp_rp < -0.5 or bp_rp > 5.0:
        return None
    temperature = 4600.0 * ((1.0 / (0.92 * bp_rp + 1.7)) + (1.0 / (0.92 * bp_rp + 0.62)))
    return max(2300.0, min(45_000.0, temperature))


def color_for_bp_rp(bp_rp: float | None) -> str:
    if bp_rp is None:
        return "#f0c987"
    if bp_rp < 0.0:
        return "#a9c7ff"
    if bp_rp < 0.45:
        return "#d4e2ff"
    if bp_rp < 0.85:
        return "#fff1c1"
    if bp_rp < 1.45:
        return "#ffd28c"
    if bp_rp < 2.4:
        return "#f4a278"
    return "#f08f6f"


def estimated_radius_solar(absolute_g_mag: float | None, bp_rp: float | None) -> float | None:
    temperature = color_temperature_from_bp_rp(bp_rp)
    if absolute_g_mag is None or temperature is None:
        return None
    luminosity = 10.0 ** ((SOLAR_ABSOLUTE_G_MAG - absolute_g_mag) / 2.5)
    radius = math.sqrt(luminosity) / ((temperature / SOLAR_EFFECTIVE_TEMPERATURE_K) ** 2)
    if not math.isfinite(radius):
        return None
    return max(0.015, min(radius, 2_000.0))


def projected_position(ra_deg: float, dec_deg: float, distance_pc: float) -> dict[str, float]:
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


def reject_none(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def selection_distance_label(args: argparse.Namespace) -> str:
    if args.max_parallax_mas <= 0 or args.min_parallax_mas <= 0:
        return "positive-parallax"
    nearest_pc = 1000.0 / args.max_parallax_mas
    farthest_pc = 1000.0 / args.min_parallax_mas
    if farthest_pc >= 1000:
        return f"{nearest_pc:.0f} pc to {farthest_pc / 1000:.0f} kpc"
    return f"{nearest_pc:.0f} to {farthest_pc:.0f} pc"


def pg_array(values: list[str]) -> str:
    escaped = [f'"{value.replace("\\\\", "\\\\\\\\").replace(chr(34), "\\\\" + chr(34))}"' for value in values]
    return "{" + ",".join(escaped) + "}"


def psql_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PGUSER", "postgres")
    env.setdefault("PGDATABASE", "starsmap_api_dev")
    return env


def run_psql(sql: str) -> None:
    subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-c", sql], env=psql_env(), check=True)


def copy_process() -> subprocess.Popen[str]:
    columns = ", ".join(COPY_COLUMNS)
    command = f"\\copy catalog_objects ({columns}) FROM STDIN WITH (FORMAT csv)"
    return subprocess.Popen(
        ["psql", "-v", "ON_ERROR_STOP=1", "-c", command],
        env=psql_env(),
        stdin=subprocess.PIPE,
        text=True,
    )


def copy_row(row: dict[str, str], args: argparse.Namespace, now: str, now_z: str) -> list[Any] | None:
    source_id = str(row.get("source_id") or "").strip()
    ra_deg = finite_float(row.get("ra"))
    dec_deg = finite_float(row.get("dec"))
    parallax_mas = finite_float(row.get("parallax"))
    apparent_g = finite_float(row.get("phot_g_mean_mag"))
    if not source_id or ra_deg is None or dec_deg is None or parallax_mas is None or parallax_mas <= 0 or apparent_g is None:
        return None

    distance_pc = 1000.0 / parallax_mas
    absolute_g = apparent_g - 5.0 * math.log10(distance_pc / 10.0)
    bp_rp = finite_float(row.get("bp_rp"))
    temperature = color_temperature_from_bp_rp(bp_rp)
    radius_solar = estimated_radius_solar(absolute_g, bp_rp)
    radius_km = radius_solar * SOLAR_RADIUS_KM if radius_solar is not None else 0.0
    position = projected_position(ra_deg, dec_deg, distance_pc)
    name = f"Gaia DR3 {source_id}"
    key = f"gaia-dr3-{source_id}"
    aliases = [name, f"Gaia {source_id}", source_id]
    search_text = " ".join([key, name, source_id, "star", args.group, "gaia", "dr3"]).lower()

    facts = reject_none(
        {
            "source_id": source_id,
            "parallax_mas": parallax_mas,
            "parallax_over_error": finite_float(row.get("parallax_over_error")),
            "bp_rp": bp_rp,
            "stellar_radius_solar": radius_solar,
            "stellar_teff_k": temperature,
            "stellar_radius_source": "estimated from Gaia G magnitude, parallax, and BP-RP color"
            if radius_solar is not None
            else None,
            "pmra_mas_yr": finite_float(row.get("pmra")),
            "pmdec_mas_yr": finite_float(row.get("pmdec")),
            "radial_velocity_km_s": finite_float(row.get("radial_velocity")),
            "astrometric_params_solved": finite_int(row.get("astrometric_params_solved")),
            "why_interesting": f"Gaia DR3 source from the {selection_distance_label(args)} bulk catalog slice.",
        }
    )
    source = {
        "catalog": args.group,
        "source": "ESA Gaia DR3 gaia_source",
        "tap_url": GAIA_TAP_URL,
        "documentation_url": GAIA_SOURCE_DOC_URL,
        "generated_at_utc": now_z,
            "selection": {
                "parallax_mas": f">= {args.min_parallax_mas} and < {args.max_parallax_mas}",
                "parallax_over_error": f">= {args.min_parallax_over_error}",
                "phot_g_mean_mag": (
                    f"> {args.min_g_mag} and <= {args.max_g_mag}"
                    if args.min_g_mag is not None
                    else f"<= {args.max_g_mag}"
                ),
            },
    }

    return [
        str(uuid.uuid4()),
        key,
        name,
        "star",
        args.group,
        "gaia_dr3",
        "gaia_dr3_epoch_2016_coordinates",
        None,
        color_for_bp_rp(bp_rp),
        radius_km,
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
        apparent_g,
        absolute_g,
        search_text,
        pg_array(aliases),
        json.dumps({"gaia_dr3_source_id": source_id}, separators=(",", ":")),
        json.dumps(facts, separators=(",", ":")),
        json.dumps(source, separators=(",", ":")),
        now,
        now,
    ]


def import_range(args: argparse.Namespace, *, delete_existing: bool) -> tuple[int, int | None]:
    expected_count = None if args.skip_count else fetch_count(args)
    if expected_count is not None:
        print(f"Gaia preflight count for {args.group}: {expected_count:,}", flush=True)

    if delete_existing:
        print(f"Deleting existing catalog group {args.group!r} before import.", flush=True)
        run_psql(f"DELETE FROM catalog_objects WHERE catalog_group = '{args.group}'")

    query = gaia_query(args)
    maxrec = args.limit or expected_count
    now_dt = datetime.now(timezone.utc).replace(microsecond=0)
    now = now_dt.isoformat().replace("+00:00", "")
    now_z = now_dt.isoformat().replace("+00:00", "Z")

    print("Streaming Gaia TAP CSV into PostgreSQL COPY.", flush=True)
    imported = 0
    with fetch_tap_csv(query, maxrec=maxrec) as response:
        reader = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8", newline=""))
        missing = sorted(set(COLUMNS) - set(reader.fieldnames or []))
        if missing:
            raise RuntimeError(f"Gaia response is missing expected columns: {', '.join(missing)}")

        process = copy_process()
        assert process.stdin is not None
        writer = csv.writer(process.stdin, lineterminator="\n")

        try:
            for source_row in reader:
                db_row = copy_row(source_row, args, now, now_z)
                if db_row is None:
                    continue
                writer.writerow(db_row)
                imported += 1
                if imported % 100_000 == 0:
                    print(f"Imported {imported:,} Gaia rows...", flush=True)
        except BrokenPipeError:
            pass
        finally:
            process.stdin.close()

        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError(f"psql COPY failed with exit code {return_code}")

    print(f"Imported {imported:,} Gaia rows into {args.group}.", flush=True)
    if expected_count is not None and imported != min(expected_count, args.limit or expected_count):
        print(f"Warning: expected {expected_count:,} rows but imported {imported:,}.", file=sys.stderr)
    return imported, expected_count


def main() -> None:
    args = parse_args()
    if args.preset == "500pc-g14":
        args.min_parallax_mas = 2.0
        args.max_parallax_mas = 20.0
        args.min_parallax_over_error = 5.0
        bins = [(None, 10.0), (10.0, 11.0), (11.0, 12.0), (12.0, 13.0), (13.0, 13.5), (13.5, 14.0)]
        total_imported = 0
        total_expected = 0
        for index, (min_g_mag, max_g_mag) in enumerate(bins):
            bin_args = argparse.Namespace(**vars(args))
            bin_args.min_g_mag = min_g_mag
            bin_args.max_g_mag = max_g_mag
            bin_args.limit = None
            imported, expected = import_range(bin_args, delete_existing=index == 0 and not args.keep_existing)
            total_imported += imported
            if expected is not None:
                total_expected += expected

        expected_label = f" / {total_expected:,} expected" if not args.skip_count else ""
        print(f"Preset {args.preset} imported {total_imported:,}{expected_label} Gaia rows into {args.group}.", flush=True)
        return

    if args.preset == "10kpc-g12":
        if args.group == DEFAULT_GROUP:
            args.group = TEN_KPC_GROUP
        args.min_parallax_mas = 0.1
        args.max_parallax_mas = 2.0
        args.min_parallax_over_error = 3.0
        bins = [
            (None, 8.0),
            (8.0, 9.0),
            (9.0, 10.0),
            (10.0, 11.0),
            (11.0, 11.25),
            (11.25, 11.5),
            (11.5, 11.75),
            (11.75, 12.0)
        ]
        total_imported = 0
        total_expected = 0
        for index, (min_g_mag, max_g_mag) in enumerate(bins):
            bin_args = argparse.Namespace(**vars(args))
            bin_args.min_g_mag = min_g_mag
            bin_args.max_g_mag = max_g_mag
            bin_args.limit = None
            imported, expected = import_range(bin_args, delete_existing=index == 0 and not args.keep_existing)
            total_imported += imported
            if expected is not None:
                total_expected += expected

        expected_label = f" / {total_expected:,} expected" if not args.skip_count else ""
        print(f"Preset {args.preset} imported {total_imported:,}{expected_label} Gaia rows into {args.group}.", flush=True)
        return

    import_range(args, delete_existing=not args.keep_existing)


if __name__ == "__main__":
    main()
