"""The discovery sweep of one solved photo: known bodies, known transients, and candidates.

The script works on the private master and writes numbers only. A source becomes a
candidate only when the frame agrees with the survey and the source is near a
cataloged galaxy. Each doubt removes the candidate: it never makes one.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import resource
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.community_sources import detect, read_rgb  # noqa: E402

import numpy as np  # noqa: E402

MAX_SIDE = 4096
EDGE_SHARE = 0.02
MAX_ELONGATION = 2.2
MIN_WIDTH = 0.55
MIN_PIXELS = 4
SATURATED = 250
GLARE_WIDTHS = 14
BODY_MATCH_ARCSEC = 8.0
SURVEY_MATCH_ARCSEC = 4.0
TRANSIENT_MATCH_ARCSEC = 5.0
GALAXY_REACH = 1.5
GALAXY_MIN_ARCMIN = 1.0
MIN_SURVEY_MATCH = 0.5
MIN_SURVEY_ROWS = 20
MAX_CANDIDATES = 20
MAX_BODIES = 40


def pixel_to_sky(wcs: dict, x: float, y: float, width: int, height: int) -> tuple[float, float]:
    """The inverse of Annotations.pixel. `x` and `y` are fractions of the image, with y from the top."""
    rad = math.pi / 180
    scale, rotation = wcs["pixel_scale_arcsec"] / 3600, wcs["rotation_deg"] * rad
    a, b, c, d = wcs.get("cd") or [scale * math.cos(rotation), -scale * math.sin(rotation), scale * math.sin(rotation), scale * math.cos(rotation)]
    cx, cy = wcs.get("crpix") or [(wcs["width"] + 1) / 2, (wcs["height"] + 1) / 2]
    u = x * wcs["width"] - cx + 0.5
    v = (1 - y) * wcs["height"] - cy + 0.5
    east, north = (a * u + b * v) * rad, (c * u + d * v) * rad
    ra0, dec0 = wcs["ra_deg"] * rad, wcs["dec_deg"] * rad
    rho = math.hypot(east, north)
    if rho == 0:
        return wcs["ra_deg"], wcs["dec_deg"]
    angle = math.atan(rho)
    dec = math.asin(math.cos(angle) * math.sin(dec0) + north * math.sin(angle) * math.cos(dec0) / rho)
    ra = ra0 + math.atan2(east * math.sin(angle), rho * math.cos(dec0) * math.cos(angle) - north * math.sin(dec0) * math.sin(angle))
    return (ra / rad) % 360, dec / rad


def reject_artifacts(sources: list[dict], width: int, height: int) -> tuple[list[dict], dict[str, int]]:
    """Removes hot pixels, trails, edge sources, and the glare and spikes of saturated stars."""
    margin_x, margin_y = width * EDGE_SHARE, height * EDGE_SHARE
    bright = [source for source in sources if source["peak"] >= SATURATED]
    kept, counts = [], {"hot_pixel": 0, "trail": 0, "edge": 0, "glare": 0}
    for source in sources:
        if source["pixels"] < MIN_PIXELS or source["width"] < MIN_WIDTH:
            counts["hot_pixel"] += 1
        elif source["elongation"] > MAX_ELONGATION:
            counts["trail"] += 1
        elif not margin_x <= source["x"] <= width - margin_x or not margin_y <= source["y"] <= height - margin_y:
            counts["edge"] += 1
        elif source["peak"] < SATURATED and any(math.hypot(source["x"] - star["x"], source["y"] - star["y"]) < GLARE_WIDTHS * star["width"] * (1 + star["flux"] / 40000) for star in bright):
            counts["glare"] += 1
        else:
            kept.append(source)
    return kept, counts


def separations_arcsec(ra: np.ndarray, dec: np.ndarray, ra0: np.ndarray, dec0: np.ndarray) -> np.ndarray:
    """For each row (ra, dec) and column (ra0, dec0). A flat sky is exact at these small angles."""
    east = ((ra[:, None] - ra0[None, :] + 180) % 360 - 180) * np.cos(np.radians(dec[:, None]))
    return np.hypot(east, dec[:, None] - dec0[None, :]) * 3600


def _nearest(sources: list[dict], rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    ra = np.array([source["ra"] for source in sources])
    dec = np.array([source["dec"] for source in sources])
    catalog_ra = np.array([row["ra"] for row in rows])
    catalog_dec = np.array([row["dec"] for row in rows])
    nearest = np.empty(len(ra))
    index = np.empty(len(ra), dtype=int)
    for start in range(0, len(ra), 200):
        part = separations_arcsec(ra[start: start + 200], dec[start: start + 200], catalog_ra, catalog_dec)
        index[start: start + 200] = part.argmin(axis=1)
        nearest[start: start + 200] = part.min(axis=1)
    return nearest, index


def _remove_offset(sources: list[dict], survey: list[dict]) -> None:
    """A solution has no distortion terms, so the median shift against the survey leaves the source positions."""
    nearest, index = _nearest(sources, survey)
    near = nearest <= SURVEY_MATCH_ARCSEC * 3
    if np.count_nonzero(near) < 8:
        return
    east = np.median([((sources[i]["ra"] - survey[index[i]]["ra"] + 180) % 360 - 180) for i in np.flatnonzero(near)])
    north = np.median([sources[i]["dec"] - survey[index[i]]["dec"] for i in np.flatnonzero(near)])
    for source in sources:
        source["ra"] = (source["ra"] - float(east)) % 360
        source["dec"] -= float(north)


def _zero_point(sources: list[dict], survey: list[dict]) -> float | None:
    nearest, index = _nearest(sources, survey)
    values = [survey[index[i]]["mag"] + 2.5 * math.log10(sources[i]["flux"]) for i in np.flatnonzero(nearest <= SURVEY_MATCH_ARCSEC) if isinstance(survey[index[i]].get("mag"), (int, float))]
    return float(np.median(values)) if len(values) >= 5 else None


def body_magnitude(row: dict) -> float:
    """The sort key of a body: brightest first, and a body with no magnitude last. Magnitude 0 is bright."""
    magnitude = row.get("magnitude")
    return float(magnitude) if isinstance(magnitude, (int, float)) and math.isfinite(magnitude) else 99.0


def classify(sources: list[dict], request: dict) -> dict:
    """Findings of one frame, in the fractions of the image. An unknown or doubtful survey gives no candidates."""
    bodies = sorted(request.get("bodies") or [], key=body_magnitude)[:MAX_BODIES]
    findings: list[dict] = []
    stats: dict = {"sources": len(sources), "bodies_listed": len(bodies), "bodies_recovered": 0, "candidates": 0, "stop": None}
    taken: set[int] = set()
    if bodies:
        nearest, index = _nearest(bodies, sources) if sources else (np.full(len(bodies), np.inf), np.zeros(len(bodies), dtype=int))
        for position, body in enumerate(bodies):
            recovered = nearest[position] <= BODY_MATCH_ARCSEC
            if recovered:
                taken.add(int(index[position]))
                stats["bodies_recovered"] += 1
            findings.append({
                "kind": "known_body",
                "designation": body["name"],
                "ra": body["ra"],
                "dec": body["dec"],
                "x": body.get("x"),
                "y": body.get("y"),
                "magnitude": body.get("magnitude"),
                "recovered": bool(recovered),
            })
    survey = request.get("dr11")
    if survey is None or len(survey) < MIN_SURVEY_ROWS:
        stats["stop"] = "no_survey"
        return {"findings": findings, "stats": stats}
    if request.get("transients") is None:
        stats["stop"] = "no_transient_list"
        return {"findings": findings, "stats": stats}
    if not sources:
        return {"findings": findings, "stats": stats}
    _remove_offset(sources, survey)
    nearest, _ = _nearest(sources, survey)
    agreement = float(np.mean(nearest <= SURVEY_MATCH_ARCSEC))
    stats["survey_match"] = round(agreement, 3)
    if agreement < MIN_SURVEY_MATCH:
        stats["stop"] = "survey_disagrees"
        return {"findings": findings, "stats": stats}
    zero_point = _zero_point(sources, survey)
    residual = [index for index in np.flatnonzero(nearest > SURVEY_MATCH_ARCSEC * 1.5).tolist() if index not in taken]
    gaia = request.get("gaia") or []
    # The lists that each candidate was compared with. A report names only these. The Gaia list
    # counts only when it has each atlas star of the field, and not only the brightest ones.
    stats["searched"] = ["dr11", "gaia", "alerce"] if request.get("gaia") is not None and request.get("gaia_complete") else ["dr11", "alerce"]
    if gaia and residual:
        separation, _ = _nearest([sources[index] for index in residual], gaia)
        residual = [index for index, value in zip(residual, separation) if value > SURVEY_MATCH_ARCSEC]
    galaxies = [row for row in request.get("galaxies") or [] if isinstance(row.get("ra"), (int, float))]
    transients = request["transients"]
    found = []
    for index in residual:
        source = sources[index]
        host = None
        for galaxy in galaxies:
            reach = max(GALAXY_MIN_ARCMIN, GALAXY_REACH * (galaxy.get("size_arcmin") or 0)) * 60
            distance = float(separations_arcsec(np.array([source["ra"]]), np.array([source["dec"]]), np.array([galaxy["ra"]]), np.array([galaxy["dec"]]))[0, 0])
            if distance <= reach and (host is None or distance < host[1]):
                host = (galaxy, distance)
        if host is None:
            continue
        known = None
        if transients:
            separation, nearest_row = _nearest([source], transients)
            if separation[0] <= TRANSIENT_MATCH_ARCSEC:
                known = transients[int(nearest_row[0])]
        found.append({
            "kind": "known_transient" if known else "candidate",
            "designation": known["name"] if known else None,
            "ra": source["ra"],
            "dec": source["dec"],
            "x": source["fx"],
            "y": source["fy"],
            "magnitude": round(zero_point - 2.5 * math.log10(source["flux"]), 1) if zero_point is not None else None,
            "near_key": host[0]["key"],
            "near_name": host[0].get("name"),
        })
    candidates = [row for row in found if row["kind"] == "candidate"]
    if len(candidates) > MAX_CANDIDATES:
        stats["stop"] = "too_many"
        found = [row for row in found if row["kind"] != "candidate"]
    stats["candidates"] = len([row for row in found if row["kind"] == "candidate"])
    return {"findings": findings + found, "stats": stats}


def sweep(image: Path, request: dict, scratch: Path) -> dict:
    scratch.mkdir(parents=True, exist_ok=True)
    pixels = read_rgb(image, scratch, MAX_SIDE)
    height, width = pixels.shape[:2]
    found = detect(pixels.astype(np.float32).mean(axis=2), threshold_sigma=6.0, limit=3000)
    kept, rejected = reject_artifacts(found, width, height)
    wcs = request["wcs"]
    sources = []
    for source in kept:
        fraction_x, fraction_y = (source["x"] + 0.5) / width, (source["y"] + 0.5) / height
        ra, dec = pixel_to_sky(wcs, fraction_x, fraction_y, width, height)
        sources.append({**source, "fx": fraction_x, "fy": fraction_y, "ra": ra, "dec": dec})
    result = classify(sources, request)
    result["stats"]["rejected"] = rejected
    return result


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    try:
        print(json.dumps(sweep(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")), Path(sys.argv[3]))))
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)[:200]}))
        sys.exit(1)
