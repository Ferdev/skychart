#!/usr/bin/env python3
"""Build a compact, survey-backed extragalactic landmark catalog.

This intentionally avoids large sky-survey downloads.  The seed table below is a
curated set of high-value Local Volume galaxies, galaxy clusters, supercluster
landmarks, and famous quasars/blazars with coordinates/distances drawn from
public extragalactic catalog services (NED/SIMBAD) and named survey catalogs
(Abell, 3C, 2MASS/2MRS, SDSS/2QZ where applicable).  It complements the broad
SIMBAD/OpenNGC imports with objects that are useful at Local Group through
cosmic-web zooms even when a live TAP import is not available.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "curated_extragalactic_survey.json"
NEARBY_SOURCE_PATH = ROOT / "data" / "sources" / "heasarc_neargalcat.json"
LIGHT_YEAR_KM = 9_460_730_472_580.8
LIGHT_YEARS_PER_MPC = 3_261_563.777


@dataclass(frozen=True)
class SurveyObject:
    key: str
    name: str
    object_type: str
    ra_deg: float
    dec_deg: float
    distance_mly: float
    source_catalog: str
    survey_class: str
    color: str
    aliases: tuple[str, ...] = ()
    redshift: float | None = None
    radius_mly: float | None = None
    apparent_magnitude: float | None = None
    notes: str = ""
    source_urls: tuple[str, ...] = ()


# Distances are deliberately rounded to avoid implying precision beyond this
# compact educational snapshot.  They are enough for heliocentric/ecliptic atlas
# placement and scale comparisons.
OBJECTS: tuple[SurveyObject, ...] = (
    SurveyObject("local-volume-lmc", "Large Magellanic Cloud", "galaxy", 80.8939, -69.7561, 0.163, "NED/SIMBAD; Local Volume Galaxy catalog", "satellite_galaxy", "#9ec8ff", ("LMC", "ESO 56-G115"), 0.000927, 0.007, 0.9, "Milky Way satellite galaxy and Local Volume distance anchor."),
    SurveyObject("local-volume-smc", "Small Magellanic Cloud", "galaxy", 13.1583, -72.8003, 0.200, "NED/SIMBAD; Local Volume Galaxy catalog", "satellite_galaxy", "#9ec8ff", ("SMC", "NGC 292"), 0.000527, 0.004, 2.7, "Nearby dwarf satellite galaxy with a well-measured Cepheid distance scale."),
    SurveyObject("local-volume-andromeda", "Andromeda Galaxy", "galaxy", 10.6847, 41.2690, 2.54, "NED/SIMBAD; Local Group catalogs", "local_group_spiral", "#d9b86f", ("M31", "NGC 224"), -0.001001, 0.110, 3.4, "Nearest giant spiral galaxy; Local Group mass anchor."),
    SurveyObject("local-volume-triangulum", "Triangulum Galaxy", "galaxy", 23.4621, 30.6602, 2.73, "NED/SIMBAD; Local Group catalogs", "local_group_spiral", "#d9b86f", ("M33", "NGC 598"), -0.000607, 0.030, 5.7, "Third-largest Local Group spiral galaxy."),
    SurveyObject("local-volume-ngc-5128", "Centaurus A", "active_galaxy", 201.3651, -43.0191, 12.0, "NED/SIMBAD; 2MASS Redshift Survey", "radio_galaxy", "#f2c36b", ("NGC 5128", "Cen A", "PKS 1322-428"), 0.001825, 0.040, 6.8, "Nearest prominent radio galaxy and active galactic nucleus."),
    SurveyObject("local-volume-m81", "Bode's Galaxy", "galaxy", 148.8882, 69.0653, 11.8, "NED/SIMBAD; 2MASS Redshift Survey", "nearby_spiral", "#d9b86f", ("M81", "NGC 3031"), -0.000113, 0.045, 6.9, "Dominant spiral of the nearby M81 Group."),
    SurveyObject("local-volume-m82", "Cigar Galaxy", "active_galaxy", 148.9697, 69.6794, 11.4, "NED/SIMBAD; 2MASS Redshift Survey", "starburst_galaxy", "#f2a66b", ("M82", "NGC 3034"), 0.000677, 0.020, 8.4, "Nearby starburst galaxy interacting with M81."),
    SurveyObject("local-volume-m101", "Pinwheel Galaxy", "galaxy", 210.8023, 54.3489, 21.0, "NED/SIMBAD; 2MASS Redshift Survey", "nearby_spiral", "#d9b86f", ("M101", "NGC 5457"), 0.000804, 0.085, 7.9, "Grand-design spiral and nearby supernova distance-ladder host."),
    SurveyObject("local-volume-m104", "Sombrero Galaxy", "galaxy", 189.9976, -11.6231, 31.1, "NED/SIMBAD; 2MASS Redshift Survey", "nearby_lenticular", "#d9b86f", ("M104", "NGC 4594"), 0.003416, 0.025, 8.0, "Massive nearby lenticular galaxy with a prominent dust lane."),
    SurveyObject("virgo-m87", "Virgo A / M87", "active_galaxy", 187.7059, 12.3911, 53.5, "NED/SIMBAD; Virgo Cluster Catalog", "cluster_central_radio_galaxy", "#f2c36b", ("M87", "NGC 4486", "Virgo A", "3C 274"), 0.00428, 0.065, 8.6, "Central Virgo Cluster elliptical; Event Horizon Telescope black-hole host."),
    SurveyObject("fornax-ngc-1399", "NGC 1399 / Fornax Cluster core", "galaxy", 54.6212, -35.4507, 65.0, "NED/SIMBAD; Fornax Cluster Catalog", "cluster_central_galaxy", "#d9b86f", ("NGC 1399", "Fornax Cluster core"), 0.004753, 0.055, 9.9, "Central elliptical marking the Fornax Cluster core."),
    SurveyObject("cluster-virgo", "Virgo Cluster", "galaxy", 187.7, 12.3, 54.0, "Virgo Cluster Catalog; NED", "galaxy_cluster", "#f2c36b", ("VCC", "Virgo I Cluster"), 0.0036, 3.5, None, "Nearest rich galaxy cluster and core of the Local Supercluster."),
    SurveyObject("cluster-fornax", "Fornax Cluster", "galaxy", 54.6, -35.5, 65.0, "Fornax Cluster Catalog; NED", "galaxy_cluster", "#f2c36b", ("Abell S0373",), 0.0046, 2.0, None, "Nearby southern galaxy cluster used for supercluster context."),
    SurveyObject("cluster-perseus-abell-426", "Perseus Cluster", "galaxy", 49.9467, 41.5131, 240.0, "Abell catalog; NED", "abell_galaxy_cluster", "#f2c36b", ("Abell 426", "A426"), 0.0179, 4.0, None, "Bright X-ray Abell cluster in the Perseus-Pisces supercluster region."),
    SurveyObject("cluster-coma-abell-1656", "Coma Cluster", "galaxy", 194.95, 27.98, 321.0, "Abell catalog; NED", "abell_galaxy_cluster", "#f2c36b", ("Abell 1656", "A1656"), 0.0231, 5.0, None, "Rich benchmark galaxy cluster in the Coma Supercluster."),
    SurveyObject("supercluster-shapley", "Shapley Supercluster core", "galaxy", 202.5, -31.0, 650.0, "NED; 2MASS/6dF redshift surveys", "supercluster_landmark", "#e8d49a", ("Shapley Concentration", "Shapley Supercluster"), 0.048, 30.0, None, "One of the most massive nearby supercluster concentrations."),
    SurveyObject("supercluster-great-attractor", "Great Attractor region", "galaxy", 200.0, -44.0, 220.0, "NED; 2MASS Redshift Survey flow reconstructions", "flow_anomaly_landmark", "#e8d49a", ("Norma Cluster region", "Laniakea attractor"), 0.016, 20.0, None, "Mass concentration associated with Local Group peculiar velocity flow."),
    SurveyObject("quasar-3c-273", "3C 273", "quasar", 187.2779, 2.0524, 2440.0, "3C radio catalog; NED/SIMBAD", "quasar", "#d7c2ff", ("PG 1226+023", "4C +02.32"), 0.158, 0.001, 12.9, "First identified quasar; bright optical/radio AGN."),
    SurveyObject("quasar-3c-279", "3C 279", "quasar", 194.0465, -5.7893, 5200.0, "3C radio catalog; NED/SIMBAD", "blazar", "#b7b5ff", ("4C -05.55",), 0.536, 0.001, 17.8, "Gamma-ray bright blazar used as a high-redshift navigation point."),
    SurveyObject("quasar-cta-102", "CTA 102", "quasar", 338.1517, 11.7308, 7600.0, "CTA/4C radio catalogs; NED/SIMBAD", "blazar", "#b7b5ff", ("4C +11.69",), 1.037, 0.001, 17.3, "Famous variable blazar at cosmological distance."),
    SurveyObject("quasar-oj-287", "OJ 287", "active_galaxy", 133.7036, 20.1085, 3500.0, "NED/SIMBAD blazar catalogs", "bl_lac_object", "#b7b5ff", ("PG 0851+203",), 0.306, 0.001, 14.8, "BL Lac object with candidate binary-supermassive-black-hole periodicity."),
    SurveyObject("quasar-markarian-421", "Markarian 421", "active_galaxy", 166.1138, 38.2088, 430.0, "Markarian catalog; NED/SIMBAD", "bl_lac_object", "#b7b5ff", ("Mrk 421", "2MASX J11042731+3812311"), 0.031, 0.001, 13.3, "Nearby TeV blazar and active-galaxy reference point."),
    SurveyObject("quasar-ton-618", "TON 618", "quasar", 186.4963, 31.4699, 18200.0, "Tonantzintla catalog; NED/SIMBAD", "luminous_quasar", "#d7c2ff", ("Ton 618",), 2.219, 0.001, 15.9, "Extremely luminous quasar often cited for its very massive black hole."),
    SurveyObject("quasar-apm-08279", "APM 08279+5255", "quasar", 127.9230, 52.7558, 23600.0, "APM survey; NED/SIMBAD", "gravitationally_lensed_quasar", "#d7c2ff", ("APM 08279+5255",), 3.911, 0.001, 15.2, "Gravitationally lensed high-redshift quasar."),
)

SOURCE_URLS = (
    "https://ned.ipac.caltech.edu/",
    "https://simbad.cds.unistra.fr/simbad/",
    "https://heasarc.gsfc.nasa.gov/W3Browse/all/abell.html",
    "https://irsa.ipac.caltech.edu/Missions/2mass.html",
)


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def finite(value: float) -> bool:
    return math.isfinite(value)


def validate_object(obj: SurveyObject) -> None:
    if not obj.key or obj.key != slugify(obj.key):
        raise ValueError(f"Invalid stable key: {obj.key!r}")
    if obj.object_type not in {"galaxy", "quasar", "active_galaxy"}:
        raise ValueError(f"Unsupported object type for {obj.key}: {obj.object_type}")
    if not (finite(obj.ra_deg) and 0.0 <= obj.ra_deg < 360.0):
        raise ValueError(f"Invalid RA for {obj.key}: {obj.ra_deg}")
    if not (finite(obj.dec_deg) and -90.0 <= obj.dec_deg <= 90.0):
        raise ValueError(f"Invalid Dec for {obj.key}: {obj.dec_deg}")
    if not (finite(obj.distance_mly) and obj.distance_mly > 0):
        raise ValueError(f"Invalid distance for {obj.key}: {obj.distance_mly}")
    if obj.radius_mly is not None and obj.radius_mly <= 0:
        raise ValueError(f"Invalid radius for {obj.key}: {obj.radius_mly}")


def row_for(obj: SurveyObject) -> dict[str, Any]:
    validate_object(obj)
    distance_ly = obj.distance_mly * 1_000_000.0
    radius_km = (obj.radius_mly or 0.0) * 1_000_000.0 * LIGHT_YEAR_KM
    aliases = [obj.name, *obj.aliases]
    facts = {
        "source_catalog": obj.source_catalog,
        "survey_class": obj.survey_class,
        "redshift": obj.redshift,
        "distance_mly": obj.distance_mly,
        "radius_mly": obj.radius_mly,
        "distance_quality": "curated_literature_or_redshift_distance",
        "why_interesting": obj.notes,
        "source_urls": list(obj.source_urls or SOURCE_URLS),
    }
    return reject_empty(
        {
            "key": obj.key,
            "name": obj.name,
            "aliases": unique(aliases),
            "object_type": obj.object_type,
            "catalog_group": "curated_extragalactic_survey",
            "source_type": "curated_extragalactic_survey",
            "position_model": "survey_ra_dec_distance_coordinates",
            "ra_deg": round(obj.ra_deg, 7),
            "dec_deg": round(obj.dec_deg, 7),
            "distance_ly": round(distance_ly, 3),
            "apparent_magnitude": obj.apparent_magnitude,
            "radius_km": radius_km,
            "color": obj.color,
            "external_ids": {
                "primary_name": obj.name,
                "ned_name": obj.name,
                "simbad_name": obj.name,
            },
            "facts": facts,
            "why_interesting": obj.notes,
        }
    )


def nearby_galaxy_rows() -> list[dict[str, Any]]:
    if not NEARBY_SOURCE_PATH.exists():
        return []
    snapshot = json.loads(NEARBY_SOURCE_PATH.read_text(encoding="utf-8"))
    source_url = snapshot["source"]["url"]
    rows: list[dict[str, Any]] = []
    used_keys: set[str] = set()
    for index, entry in enumerate(snapshot["objects"]):
        name = re.sub(r"\s+", " ", str(entry["name"])).strip()
        distance_mpc = float(entry["distance"])
        distance_ly = distance_mpc * LIGHT_YEARS_PER_MPC
        major_axis_arcmin = entry.get("major_axis")
        radius_ly = None
        if major_axis_arcmin is not None and float(major_axis_arcmin) > 0:
            angular_radius_rad = math.radians(float(major_axis_arcmin) / 120.0)
            radius_ly = distance_ly * math.tan(angular_radius_rad)
        base_key = f"heasarc-neargalcat-{slugify(name)}"
        key = base_key if base_key not in used_keys else f"{base_key}-{index + 1}"
        used_keys.add(key)
        apparent_magnitude = entry.get("bmag") if entry.get("bmag") is not None else entry.get("ks_mag")
        rows.append(reject_empty({
            "key": key,
            "name": name,
            "aliases": [name],
            "object_type": "galaxy",
            "catalog_group": "curated_extragalactic_survey",
            "source_type": "curated_extragalactic_survey",
            "position_model": "heasarc_neargalcat_j2000_distance_coordinates",
            "ra_deg": round(float(entry["ra"]), 7),
            "dec_deg": round(float(entry["dec"]), 7),
            "distance_ly": round(distance_ly, 3),
            "apparent_magnitude": apparent_magnitude,
            "radius_km": (radius_ly or 0.0) * LIGHT_YEAR_KM,
            "color": "#9ec8ff",
            "external_ids": {"heasarc_neargalcat_name": name},
            "facts": {
                "source_catalog": "HEASARC NEARGALCAT",
                "survey_class": "nearby_galaxy",
                "distance_mpc": distance_mpc,
                "distance_method": entry.get("distance_method"),
                "morphology_type_code": entry.get("morph_type"),
                "heasarc_class": entry.get("class"),
                "major_axis_arcmin": major_axis_arcmin,
                "distance_quality": "individual_distance_estimate_from_neargalcat",
                "source_urls": [source_url],
                "why_interesting": "Nearby galaxy with a catalogued individual distance estimate in the Local Volume.",
            },
            "why_interesting": "Nearby galaxy with a catalogued individual distance estimate in the Local Volume.",
        }))
    return rows


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = re.sub(r"\s+", " ", str(value)).strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def reject_empty(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: reject_empty(item) for key, item in value.items() if item not in (None, "", [], {})}
    if isinstance(value, list):
        return [reject_empty(item) for item in value if item not in (None, "", [], {})]
    return value


def build_catalog() -> dict[str, Any]:
    objects = [row_for(obj) for obj in OBJECTS]
    seed_names = {alias.lower() for obj in objects for alias in obj.get("aliases", [])}
    objects.extend(obj for obj in nearby_galaxy_rows() if obj["name"].lower() not in seed_names)
    if len({obj["key"] for obj in objects}) != len(objects):
        raise RuntimeError("Duplicate curated extragalactic keys")
    objects.sort(key=lambda item: (item["object_type"], item["facts"].get("distance_mly", 0), item["name"]))
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "label": "Curated extragalactic survey landmarks",
            "description": "Real-catalog-backed Local Volume galaxies plus curated cluster, supercluster, and quasar landmarks for physical atlas navigation.",
            "primary_services": ["NASA HEASARC", "NASA/IPAC Extragalactic Database", "CDS SIMBAD"],
            "survey_catalogs": ["HEASARC NEARGALCAT", "Local Volume Galaxy catalog", "Virgo Cluster Catalog", "Fornax Cluster Catalog", "Abell clusters", "3C radio catalog", "2MASS/2MRS", "APM"],
            "urls": ["https://heasarc.gsfc.nasa.gov/W3Browse/galaxy-catalog/neargalcat.html", *SOURCE_URLS],
        },
        "selection": {
            "included": "NEARGALCAT galaxies with positive individual distance estimates plus named landmarks useful across Local Group, cluster, supercluster, and quasar-field zooms.",
            "download_policy": "The compact checked-in HEASARC source snapshot makes catalog builds deterministic and offline.",
            "distance_note": "Distances are rounded literature/redshift distances in million light years for atlas placement, not precision cosmology fitting.",
        },
        "object_count": len(objects),
        "objects": objects,
    }


def main() -> None:
    catalog = build_catalog()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {catalog['object_count']} curated extragalactic survey objects to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
