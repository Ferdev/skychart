import math

import numpy as np
import pytest

from backend.errors import QueryInputError
from backend.night_planner import night_plan_payload
from backend.transit_timing import (
    barycentric_times,
    fit_transit,
    predicted_uncertainty_days,
    target_by_key,
    transit_fit_payload,
    transit_targets,
    trapezoid,
)

WASP_12 = "exoplanet-wasp-12-b"
HAWAII = {"latitude_deg": 19.8, "longitude_deg": -155.5}


def minutes(first, second):
    from datetime import datetime

    parse = lambda value: datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (parse(first) - parse(second)).total_seconds() / 60


def light_curve(target, epoch, shift_minutes=0.0, noise=0.0015, seed=1, cadence=1.0, span=None, wave=0.0):
    middle = target["reference_time_bjd"] + epoch * target["period_days"] + shift_minutes / 1440
    duration = target["duration_hours"] * 60
    half = (span or duration + 120) / 2
    offsets = np.arange(-half, half, cadence)
    bjd = middle + offsets / 1440
    depth = target["depth_ppt"] / 1000
    ingress = duration * 0.15
    rng = np.random.default_rng(seed)
    flux = 1 - depth * trapezoid(offsets, 0.0, duration, ingress) + rng.normal(0, noise, len(offsets)) + 1.5e-5 * offsets
    flux += wave * np.sin(offsets / 18)
    return bjd, flux, np.full(len(offsets), noise)


def test_each_target_is_deep_bright_and_has_an_ephemeris():
    rows = transit_targets()
    assert sum(row["status"] == "confirmed" for row in rows) >= 150
    for row in rows:
        assert row["depth_ppt"] >= 5 and row["magnitude"] <= 12.5
        assert row["reference_time_err_days"] >= 0 and row["period_err_days"] >= 0
        assert 0.5 <= row["duration_hours"] <= 8


def test_predicted_uncertainty_adds_the_period_error_for_each_orbit():
    target = target_by_key(WASP_12)
    assert predicted_uncertainty_days(target, 0) == pytest.approx(target["reference_time_err_days"])
    assert predicted_uncertainty_days(target, 1000) == pytest.approx(math.hypot(3.2e-05, 1000 * 1.8e-08))


def test_barycentric_correction_is_inside_the_light_time_of_one_au():
    target = target_by_key(WASP_12)
    utc = np.array([2461000.5, 2461091.5, 2461182.5])
    delta_days = barycentric_times(utc, target) - utc
    # TDB is 69.2 s ahead of UTC, and the light time of 1 au is 499 s.
    assert np.all(np.abs(delta_days * 86400 - 69.2) < 505)
    assert np.ptp(delta_days) * 86400 > 300


def test_night_plan_transit_list_uses_the_dark_window_and_the_altitude_limit():
    payload = night_plan_payload({**HAWAII, "date": "2026-12-05", "limit": 1, "include_transits": True, "min_altitude_deg": 30})
    transits = payload["transits"]["transits"]
    assert transits
    window = payload["window"]
    for row in transits:
        assert minutes(row["mid_utc"], window["start_utc"]) >= 0
        assert minutes(window["end_utc"], row["mid_utc"]) >= 0
        assert row["altitude_mid_deg"] >= 30
        assert row["coverage"] in {"full", "no_baseline", "partial"}
    assert [row["status"] for row in transits] == sorted((row["status"] for row in transits), key=lambda value: value != "confirmed")


def test_night_plan_has_no_transit_list_unless_the_request_asks_for_it():
    assert "transits" not in night_plan_payload({**HAWAII, "date": "2026-12-05", "limit": 1})


def test_predicted_mid_time_of_a_known_transit_matches_the_ephemeris():
    payload = night_plan_payload({**HAWAII, "date": "2026-12-05", "limit": 1, "include_transits": True, "min_altitude_deg": 10})
    row = next((item for item in payload["transits"]["transits"] if item["status"] == "confirmed"), None)
    assert row
    target = target_by_key(row["key"])
    parsed = np.datetime64(row["mid_utc"].replace("Z", ""), "ms").astype("datetime64[ms]").astype(np.int64) / 86_400_000 + 2440587.5
    bjd = barycentric_times(np.array([parsed]), target)[0]
    assert (bjd - (target["reference_time_bjd"] + row["epoch"] * target["period_days"])) * 1440 == pytest.approx(0, abs=0.05)


def test_fit_reproduces_a_known_transit_inside_the_stated_uncertainty():
    target = target_by_key(WASP_12)
    pulls = []
    for seed in range(40):
        shift = -3.0 + seed * 0.15
        result = fit_transit(target, *light_curve(target, 3000, shift_minutes=shift, seed=seed))
        assert result["accepted"], result["reasons"]
        pulls.append((result["o_minus_c_minutes"] - shift) / result["uncertainty_minutes"])
        assert result["depth_ppt"] == pytest.approx(target["depth_ppt"], rel=0.2)
    assert float(np.std(pulls)) < 1.3
    assert abs(float(np.mean(pulls))) < 0.8


def test_fit_rejects_a_flat_light_curve():
    target = target_by_key(WASP_12)
    bjd, flux, error = light_curve(target, 3000)
    result = fit_transit(target, bjd, np.random.default_rng(3).normal(1, 0.0015, len(bjd)), error)
    assert not result["accepted"]
    assert "no_depth" in result["reasons"]


def test_red_noise_increases_the_timing_error():
    target = target_by_key(WASP_12)
    white = fit_transit(target, *light_curve(target, 3000))
    correlated = fit_transit(target, *light_curve(target, 3000, wave=0.003))
    assert correlated["red_noise_factor"] > 1.2
    assert correlated["uncertainty_minutes"] > white["uncertainty_minutes"]


def test_fit_payload_checks_the_measurements():
    with pytest.raises(QueryInputError):
        transit_fit_payload({"key": "exoplanet-unknown", "points": []})
    with pytest.raises(QueryInputError):
        transit_fit_payload({"key": WASP_12, "points": [[2461000.5, 1.0, 0.001]] * 3})
    with pytest.raises(QueryInputError):
        transit_fit_payload({"key": WASP_12, "points": [[2461000.5 + index, 1.0, 0.001] for index in range(30)]})
    with pytest.raises(QueryInputError):
        transit_fit_payload({"key": WASP_12, "points": [[2461000.5, -1.0, 0.001]] * 30})


def test_fit_payload_converts_frame_times_to_barycentric_time():
    target = target_by_key(WASP_12)
    bjd, flux, error = light_curve(target, 3000, shift_minutes=2.0)
    utc = bjd - (barycentric_times(bjd, target) - bjd)
    points = [[float(a), float(b), float(c)] for a, b, c in zip(utc, flux, error)]
    result = transit_fit_payload({"key": WASP_12, "points": points})
    assert result["epoch"] == 3000
    assert result["o_minus_c_minutes"] == pytest.approx(2.0, abs=3 * result["uncertainty_minutes"])
