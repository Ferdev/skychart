"""Predicted transits for one night and the fit of a measured light curve.

All transit times of the target file are BJD-TDB. A frame time from a telescope is
UTC at the observer, so this module adds the light travel time to the barycenter.
It uses the center of the Earth: the site changes a time by at most 21 ms, and the
site of a person does not have to reach this calculation.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

import numpy as np

from backend.errors import QueryInputError
from backend.scientific_calculation import isoformat_utc, skyfield_context
from backend.settings import TRANSIT_TARGETS_PATH

AU_LIGHT_DAYS = 149_597_870.700 / 299_792.458 / 86_400.0
# Half an hour of flat star on each side of a transit sets the baseline of the fit.
BASELINE_MINUTES = 30.0
MAX_TRANSITS = 40
METHOD_VERSION = "trapezoid-1"
MIN_POINTS = 20
MAX_POINTS = 4000
MAX_BODY_BYTES = 256_000
# A grid of mid-times, then a smaller grid near the best value.
COARSE_STEP_MINUTES = 1.0
FINE_STEP_MINUTES = 0.05
FINE_REACH_MINUTES = 6.0
DURATION_SCALES = (0.8, 0.9, 1.0, 1.1, 1.2)
# Impact parameter for the fixed share of ingress in the model.
IMPACT = 0.5
MIN_DEPTH_SIGMA = 3.0
MAX_TIMING_ERROR_MINUTES = 15.0
MAX_MODEL_POINTS = 240


@lru_cache(maxsize=1)
def transit_targets() -> tuple[dict[str, Any], ...]:
    return tuple(json.loads(TRANSIT_TARGETS_PATH.read_text(encoding="utf-8"))["targets"])


def target_by_key(key: Any) -> dict[str, Any]:
    target = next((row for row in transit_targets() if row["key"] == key), None)
    if target is None:
        raise QueryInputError("this planet is not a transit target")
    return target


def directions(rows: list[dict[str, Any]]) -> np.ndarray:
    right_ascension = np.radians([row["ra_deg"] for row in rows])
    declination = np.radians([row["dec_deg"] for row in rows])
    return np.stack([np.cos(declination) * np.cos(right_ascension), np.cos(declination) * np.sin(right_ascension), np.sin(declination)], axis=1)


def predicted_uncertainty_days(target: dict[str, Any], epoch: float) -> float:
    return math.hypot(target["reference_time_err_days"], epoch * target["period_err_days"])


def _earth_light_days(ephemeris: Any, times: Any) -> np.ndarray:
    """The position of the Earth from the barycenter, in light days, with one column for each time."""
    return ephemeris["earth"].at(times).position.au * AU_LIGHT_DAYS


def predicted_transits(
    rows: list[dict[str, Any]],
    grid_times: Any,
    start: datetime,
    step_minutes: float,
    zenith: np.ndarray,
    moon_directions: np.ndarray,
    min_altitude: float,
    ephemeris: Any,
) -> dict[str, Any]:
    """Transits in one dark window, on the time grid and with the site rotation of the night plan."""
    if not rows:
        return {"total": 0, "transits": []}
    unit = directions(rows)
    grid_minutes = np.arange(zenith.shape[1]) * step_minutes
    altitudes = np.degrees(np.arcsin(np.clip(unit @ zenith, -1.0, 1.0)))
    corrections = unit @ _earth_light_days(ephemeris, grid_times)
    grid_tdb = np.asarray(grid_times.tdb, dtype=np.float64)
    window_minutes = float(grid_minutes[-1])
    found = []
    for index, target in enumerate(rows):
        period = target["period_days"]
        half = target["duration_hours"] * 30.0
        bjd = grid_tdb + corrections[index]
        first = math.ceil((bjd[0] - target["reference_time_bjd"]) / period - half / 1440 / period)
        last = math.floor((bjd[-1] - target["reference_time_bjd"]) / period + half / 1440 / period)
        for epoch in range(first, last + 1):
            mid_bjd = target["reference_time_bjd"] + epoch * period
            mid = float(np.interp(mid_bjd, bjd, grid_minutes, left=math.nan, right=math.nan))
            if not math.isfinite(mid):
                mid = (mid_bjd - bjd[0]) * 1440.0
            altitude_at = lambda minutes: float(np.interp(minutes, grid_minutes, altitudes[index]))
            usable = lambda minutes: 0 <= minutes <= window_minutes and altitude_at(minutes) >= min_altitude
            if not usable(mid):
                continue
            ingress, egress = mid - half, mid + half
            if usable(ingress - BASELINE_MINUTES) and usable(egress + BASELINE_MINUTES) and usable(ingress) and usable(egress):
                coverage = "full"
            elif usable(ingress) and usable(egress):
                coverage = "no_baseline"
            else:
                coverage = "partial"
            moment = lambda minutes: isoformat_utc(start + timedelta(minutes=minutes))
            nearest = int(np.argmin(np.abs(grid_minutes - mid)))
            separation = math.degrees(math.acos(float(np.clip(unit[index] @ moon_directions[:, nearest], -1.0, 1.0))))
            found.append({
                **{name: target[name] for name in ("key", "host_key", "name", "host_name", "status", "ra_deg", "dec_deg", "magnitude", "magnitude_band", "depth_ppt", "duration_hours")},
                "epoch": epoch,
                "coverage": coverage,
                "ingress_utc": moment(ingress),
                "mid_utc": moment(mid),
                "egress_utc": moment(egress),
                "uncertainty_minutes": round(predicted_uncertainty_days(target, epoch) * 1440.0, 2),
                "altitude_ingress_deg": round(altitude_at(ingress), 1),
                "altitude_mid_deg": round(altitude_at(mid), 1),
                "altitude_egress_deg": round(altitude_at(egress), 1),
                "moon_separation_deg": round(separation, 1),
            })
    order = {"full": 0, "no_baseline": 1, "partial": 2}
    # A person proves the setup on a known planet first.
    found.sort(key=lambda row: (row["status"] != "confirmed", order[row["coverage"]], row["mid_utc"], row["key"]))
    return {"total": len(found), "transits": found[:MAX_TRANSITS]}


def candidates_for_site(latitude: float, min_altitude: float) -> list[dict[str, Any]]:
    return [row for row in transit_targets() if 90 - abs(latitude - row["dec_deg"]) >= min_altitude]


def _utc_times(jd_utc: np.ndarray) -> Any:
    timescale, _ = skyfield_context()
    origin = math.floor(float(jd_utc[0]) - 0.5) + 0.5
    midnight = datetime(2000, 1, 1, tzinfo=timezone.utc) + timedelta(days=origin - 2451544.5)
    seconds = (jd_utc - origin) * 86_400.0
    return timescale.utc(midnight.year, midnight.month, midnight.day, 0, 0, seconds)


def barycentric_times(jd_utc: np.ndarray, target: dict[str, Any]) -> np.ndarray:
    """BJD-TDB of times in JD-UTC, for the direction of one target."""
    _, ephemeris = skyfield_context()
    times = _utc_times(jd_utc)
    return np.asarray(times.tdb, dtype=np.float64) + directions([target])[0] @ _earth_light_days(ephemeris, times)


def utc_from_bjd(bjd: float, target: dict[str, Any]) -> str:
    timescale, ephemeris = skyfield_context()
    tdb = bjd
    for _ in range(3):
        tdb = bjd - float(directions([target])[0] @ _earth_light_days(ephemeris, timescale.tdb_jd(tdb)))
    return isoformat_utc(timescale.tdb_jd(tdb).utc_datetime())


def trapezoid(time: np.ndarray, middle: float, duration: float, ingress: float) -> np.ndarray:
    """The dip of the model from 0 to 1. `duration` is first to last contact."""
    return np.clip((duration / 2 - np.abs(time - middle)) / max(ingress, 1e-9), 0.0, 1.0)


def _solve(flux: np.ndarray, error: np.ndarray, time: np.ndarray, shape: np.ndarray) -> tuple[float, np.ndarray]:
    weights = 1.0 / error
    design = np.stack([np.ones_like(time), time, -shape], axis=1) * weights[:, None]
    solution, *_ = np.linalg.lstsq(design, flux * weights, rcond=None)
    residual = flux * weights - design @ solution
    return float(residual @ residual), solution


def _curvature_error(middles: np.ndarray, chi_square: np.ndarray) -> float:
    """The width of the chi-square curve near its minimum: the distance at which it rises by 1."""
    near = chi_square <= chi_square.min() + 4.0
    if np.count_nonzero(near) < 5:
        return 0.0
    curvature = float(np.polyfit(middles[near], chi_square[near], 2)[0])
    return 1.0 / math.sqrt(curvature) if curvature > 0 else 0.0


def _white_noise_floor(sigma: np.ndarray, spacing_minutes: float, depth: float, ingress_minutes: float) -> float:
    """The analytic timing error of a trapezoid (Carter et al. 2008). The fit cannot do better than this."""
    if depth <= 0:
        return 0.0
    return float(np.median(sigma)) / depth * math.sqrt(ingress_minutes * spacing_minutes / 2)


def _red_noise_factor(residuals: np.ndarray, error: np.ndarray, spacing_minutes: float, ingress_minutes: float) -> float:
    """Time-averaging: the factor by which binned residuals are above white noise at the time scale of ingress."""
    size = int(max(2, round(ingress_minutes / max(spacing_minutes, 1e-6))))
    bins = len(residuals) // size
    if bins < 4:
        return 1.0
    binned = residuals[: bins * size].reshape(bins, size).mean(axis=1)
    expected = float(np.median(error)) / math.sqrt(size) * math.sqrt(bins / (bins - 1))
    return max(1.0, float(binned.std()) / expected)


def fit_transit(target: dict[str, Any], bjd: np.ndarray, flux: np.ndarray, error: np.ndarray) -> dict[str, Any]:
    order = np.argsort(bjd)
    bjd, flux, error = bjd[order], flux[order], error[order]
    period = target["period_days"]
    epoch = round((float(np.median(bjd)) - target["reference_time_bjd"]) / period)
    predicted = target["reference_time_bjd"] + epoch * period
    origin = predicted
    minutes = (bjd - origin) * 1440.0
    level = float(np.median(flux))
    relative, sigma = flux / level, error / level
    catalog_duration = target["duration_hours"] * 60.0
    ratio = math.sqrt(max(target["depth_ppt"], 0.1) / 1000.0)
    ingress_share = min(0.3, ratio / (1 - IMPACT**2))
    span = max(float(minutes[-1]) - float(minutes[0]), 1.0)
    predicted_error = predicted_uncertainty_days(target, epoch) * 1440.0
    reach = min(max(catalog_duration, 5 * predicted_error, 30.0), 240.0)

    def scan(middles: np.ndarray, scales: tuple[float, ...]) -> np.ndarray:
        table = np.full((len(scales), len(middles)), np.inf)
        for row, scale in enumerate(scales):
            duration = catalog_duration * scale
            for column, middle in enumerate(middles):
                table[row, column], _ = _solve(relative, sigma, minutes - middle, trapezoid(minutes, float(middle), duration, duration * ingress_share))
        return table

    coarse = np.arange(-reach, reach + COARSE_STEP_MINUTES / 2, COARSE_STEP_MINUTES)
    table = scan(coarse, DURATION_SCALES)
    row, column = np.unravel_index(int(np.argmin(table)), table.shape)
    scale = DURATION_SCALES[int(row)]
    fine = np.arange(coarse[column] - FINE_REACH_MINUTES, coarse[column] + FINE_REACH_MINUTES, FINE_STEP_MINUTES)
    profile = scan(fine, (scale,))[0]
    best = int(np.argmin(profile))
    middle = float(fine[best])
    duration = catalog_duration * scale
    ingress = duration * ingress_share
    shape = trapezoid(minutes, middle, duration, ingress)
    chi_square, solution = _solve(relative, sigma, minutes - middle, shape)
    residuals = relative - (solution[0] + solution[1] * (minutes - middle) - solution[2] * shape)
    freedom = max(len(minutes) - 5, 1)
    reduced = chi_square / freedom
    spacing = float(np.median(np.diff(minutes))) if len(minutes) > 1 else 1.0
    # The scatter of the light curve sets the noise: a frame header can give a wrong gain in both directions.
    scale_noise = max(math.sqrt(reduced), 1e-3)
    beta = _red_noise_factor(residuals, sigma * scale_noise, spacing, ingress)

    timing_error = max(_curvature_error(fine, profile / scale_noise**2), _white_noise_floor(sigma * scale_noise, spacing, float(solution[2]), ingress), FINE_STEP_MINUTES) * beta

    design = np.stack([np.ones_like(minutes), minutes - middle, -shape], axis=1) / (sigma * scale_noise * beta)[:, None]
    covariance = np.linalg.pinv(design.T @ design)
    depth = float(solution[2] / solution[0])
    depth_error = float(math.sqrt(max(covariance[2, 2], 0.0)) / solution[0])
    before = int(np.count_nonzero(minutes < middle - duration / 2))
    after = int(np.count_nonzero(minutes > middle + duration / 2))
    during = int(np.count_nonzero(np.abs(minutes - middle) < duration / 2))
    has_ingress = bool(np.any(np.abs(minutes - (middle - duration / 2 + ingress / 2)) <= max(ingress, 2 * spacing)))
    has_egress = bool(np.any(np.abs(minutes - (middle + duration / 2 - ingress / 2)) <= max(ingress, 2 * spacing)))
    baseline_points = residuals[shape == 0]
    reasons = []
    if not has_ingress and not has_egress:
        reasons.append("no_contact")
    if before + after < 5:
        reasons.append("no_baseline")
    if during < 5:
        reasons.append("no_transit")
    if depth <= 0 or depth / max(depth_error, 1e-9) < MIN_DEPTH_SIGMA:
        reasons.append("no_depth")
    if timing_error > MAX_TIMING_ERROR_MINUTES:
        reasons.append("timing_error")
    mid_bjd = origin + middle / 1440.0
    keep = np.linspace(0, len(minutes) - 1, min(len(minutes), MAX_MODEL_POINTS)).astype(int)
    model = solution[0] + solution[1] * (minutes - middle) - solution[2] * shape
    return {
        "accepted": not reasons,
        "reasons": reasons,
        "method_version": METHOD_VERSION,
        "epoch": epoch,
        "mid_time_bjd_tdb": round(mid_bjd, 6),
        "mid_time_utc": utc_from_bjd(mid_bjd, target),
        "uncertainty_minutes": round(timing_error, 2),
        "predicted_bjd_tdb": round(predicted, 6),
        "predicted_uncertainty_minutes": round(predicted_error, 2),
        "o_minus_c_minutes": round(middle, 2),
        "depth_ppt": round(depth * 1000, 2),
        "depth_error_ppt": round(depth_error * 1000, 2),
        "duration_minutes": round(duration, 1),
        "reduced_chi_square": round(reduced, 2),
        "red_noise_factor": round(beta, 2),
        "baseline_rms_ppt": round(float(baseline_points.std()) * 1000, 2) if baseline_points.size > 1 else None,
        "points_before": before,
        "points_in_transit": during,
        "points_after": after,
        "span_minutes": round(span, 1),
        "ephemeris": {name: target[name] for name in ("reference_time_bjd", "reference_time_err_days", "period_days", "period_err_days")},
        "model": {
            "minutes": [round(float(value), 2) for value in minutes[keep]],
            "flux": [round(float(value), 5) for value in model[keep]],
        },
    }


def transit_fit_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise QueryInputError("the request body must be a JSON object")
    target = target_by_key(body.get("key"))
    points = body.get("points")
    if not isinstance(points, list) or not MIN_POINTS <= len(points) <= MAX_POINTS:
        raise QueryInputError(f"points must hold {MIN_POINTS} to {MAX_POINTS} measurements")
    try:
        table = np.array(points, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise QueryInputError("each measurement must be three numbers") from exc
    if table.ndim != 2 or table.shape[1] != 3 or not np.all(np.isfinite(table)):
        raise QueryInputError("each measurement must be three numbers")
    jd_utc, flux, error = table[:, 0], table[:, 1], table[:, 2]
    if np.any(flux <= 0) or np.any(error <= 0):
        raise QueryInputError("flux and error must be above zero")
    if np.any(jd_utc < 2_415_021) or np.any(jd_utc > 2_488_434) or float(jd_utc.max() - jd_utc.min()) > 1.0:
        raise QueryInputError("the measurements must be from one night")
    return fit_transit(target, barycentric_times(jd_utc, target), flux, error)
