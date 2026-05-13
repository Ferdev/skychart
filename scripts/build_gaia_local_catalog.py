from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "gaia_local_stars.json"
GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_SOURCE_DOC_URL = "https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html"

SOLAR_RADIUS_KM = 695_700.0
SOLAR_EFFECTIVE_TEMPERATURE_K = 5772.0
SOLAR_ABSOLUTE_G_MAG = 4.67

DEFAULT_LIMIT = int(os.environ.get("GAIA_LOCAL_LIMIT", "35000"))
MIN_PARALLAX_MAS = float(os.environ.get("GAIA_LOCAL_MIN_PARALLAX_MAS", "20"))
MIN_PARALLAX_OVER_ERROR = float(os.environ.get("GAIA_LOCAL_MIN_PARALLAX_OVER_ERROR", "10"))
MAX_G_MAG = float(os.environ.get("GAIA_LOCAL_MAX_G_MAG", "16"))

QUERY = f"""
SELECT TOP {DEFAULT_LIMIT}
  source_id,
  ra,
  dec,
  parallax,
  parallax_over_error,
  phot_g_mean_mag,
  bp_rp,
  pmra,
  pmdec,
  radial_velocity,
  astrometric_params_solved
FROM gaiadr3.gaia_source
WHERE parallax >= {MIN_PARALLAX_MAS}
  AND parallax_over_error >= {MIN_PARALLAX_OVER_ERROR}
  AND phot_g_mean_mag IS NOT NULL
  AND phot_g_mean_mag <= {MAX_G_MAG}
ORDER BY phot_g_mean_mag ASC
""".strip()

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


def fetch_json(query: str) -> dict[str, Any]:
    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "json",
        "QUERY": query,
    }
    request = Request(
        f"{GAIA_TAP_URL}?{urlencode(params)}",
        headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"},
    )
    with urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


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
    # Gaia DR3 broad color gives only a rough visual temperature estimate.
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


def build_star(row: dict[str, Any]) -> dict[str, Any] | None:
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
    radius_solar = estimated_radius_solar(absolute_g, bp_rp)
    temperature = color_temperature_from_bp_rp(bp_rp)

    return {
        "key": f"gaia-dr3-{source_id}",
        "name": f"Gaia DR3 {source_id}",
        "aliases": [f"Gaia DR3 {source_id}", f"Gaia {source_id}", source_id],
        "ra_deg": ra_deg,
        "dec_deg": dec_deg,
        "distance_pc": distance_pc,
        "parallax_mas": parallax_mas,
        "apparent_magnitude": apparent_g,
        "absolute_magnitude": absolute_g,
        "bp_rp": bp_rp,
        "stellar_teff_k": temperature,
        "stellar_radius_solar": radius_solar,
        "stellar_radius_source": "estimated from Gaia G magnitude, parallax, and BP-RP color" if radius_solar is not None else None,
        "radius_km": radius_solar * SOLAR_RADIUS_KM if radius_solar is not None else 0.0,
        "color": color_for_bp_rp(bp_rp),
        "source_id": source_id,
        "parallax_over_error": finite_float(row.get("parallax_over_error")),
        "pmra_mas_yr": finite_float(row.get("pmra")),
        "pmdec_mas_yr": finite_float(row.get("pmdec")),
        "radial_velocity_km_s": finite_float(row.get("radial_velocity")),
        "astrometric_params_solved": finite_int(row.get("astrometric_params_solved")),
        "why_interesting": "Nearby Gaia DR3 source from the local-neighborhood catalog slice.",
    }


def reject_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: reject_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [reject_none(item) for item in value if item is not None]
    return value


def main() -> None:
    payload = fetch_json(QUERY)
    rows = [dict(zip(COLUMNS, values)) for values in payload.get("data", [])]
    stars = [build_star(row) for row in rows]
    stars = [reject_none(star) for star in stars if star is not None]
    stars.sort(key=lambda star: (star["apparent_magnitude"], star["distance_pc"], star["source_id"]))

    output = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "ESA Gaia DR3 gaia_source",
            "tap_url": GAIA_TAP_URL,
            "documentation_url": GAIA_SOURCE_DOC_URL,
            "query": QUERY,
        },
        "selection": {
            "limit": DEFAULT_LIMIT,
            "parallax_mas": f">= {MIN_PARALLAX_MAS}",
            "parallax_over_error": f">= {MIN_PARALLAX_OVER_ERROR}",
            "phot_g_mean_mag": f"<= {MAX_G_MAG}",
        },
        "star_count": len(stars),
        "stars": stars,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {output['star_count']} Gaia DR3 local stars to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
