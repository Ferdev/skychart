import json
from datetime import datetime, timezone

import pytest

from backend.errors import QueryInputError
from backend.night_planner import night_plan_payload, target_catalog
from backend.scientific_calculation import observe_payload

BERLIN = {"latitude_deg": 52.52, "longitude_deg": 13.405}
USHUAIA = {"latitude_deg": -54.8, "longitude_deg": -68.3}
HELSINKI = {"latitude_deg": 60.2, "longitude_deg": 24.9}


def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def minutes_between(first, second):
    return abs((moment(first) - moment(second)).total_seconds()) / 60


def plan(site, day, **options):
    return night_plan_payload({**site, "date": day, **options})


def target(payload, key):
    return next(row for row in payload["targets"] if row["key"] == key)


def test_dusk_and_dawn_match_jpl_horizons():
    # JPL Horizons, airless apparent Sun altitude, site 13.405E 52.52N: -17.161 at 17:20 and -18.651 at 17:30 UTC.
    berlin = plan(BERLIN, "2026-01-15", limit=1)
    assert berlin["darkness"] == "astronomical"
    assert minutes_between(berlin["window"]["start_utc"], "2026-01-15T17:25:42Z") < 0.5
    assert berlin["window"] == {"start_utc": berlin["twilight"]["astronomical"]["dusk_utc"], "end_utc": berlin["twilight"]["astronomical"]["dawn_utc"]}


def test_far_southern_site_matches_jpl_horizons():
    # JPL Horizons, site 68.3W 54.8S: -16.870 at 22:20 and -18.255 at 22:30 UTC on 2026-06-21.
    payload = plan(USHUAIA, "2026-06-21", limit=200, types=["galaxy"], max_magnitude=3)
    assert minutes_between(payload["window"]["start_utc"], "2026-06-21T22:28:10Z") < 0.5
    # The Small Magellanic Cloud culminates south of the zenith, at 90 - |-54.8 + 72.83| degrees.
    assert target(payload, "ngc-292")["best_altitude_deg"] == pytest.approx(71.97, abs=0.5)


def test_summer_site_with_no_astronomical_darkness():
    # JPL Horizons, site 24.9E 60.2N: the Sun reaches only -6.35 degrees at 22:30 UTC on 2026-06-21.
    payload = plan(HELSINKI, "2026-06-21", limit=3)
    assert payload["darkness"] == "civil"
    assert payload["twilight"]["astronomical"] is None and payload["twilight"]["nautical"] is None
    assert minutes_between(payload["window"]["start_utc"], "2026-06-21T21:44:00Z") < 1.5
    assert minutes_between(payload["window"]["end_utc"], "2026-06-21T23:00:30Z") < 1.5


def test_midnight_sun_has_no_window_and_no_targets():
    payload = plan({"latitude_deg": 69.65, "longitude_deg": 18.95}, "2026-06-21")
    assert (payload["darkness"], payload["window"], payload["targets"]) == ("none", None, [])


def test_polar_night_has_a_full_window_with_no_dusk():
    payload = plan({"latitude_deg": 89.9, "longitude_deg": 0}, "2026-12-21", limit=1)
    assert payload["twilight"]["astronomical"] == {"dusk_utc": None, "dawn_utc": None}
    assert payload["targets"][0]["minutes_above"] == pytest.approx(1440, abs=1)


def test_altitude_windows_match_the_full_apparent_chain():
    row = target(plan(BERLIN, "2026-10-30", types=["nebula"], max_magnitude=9), "m1")
    window = row["windows"][0]
    edge = observe_payload("m1", 52.52, 13.405, moment(window["start_utc"]))
    assert edge["altitude_deg"] == pytest.approx(30, abs=0.1)
    best = observe_payload("m1", 52.52, 13.405, moment(row["best_utc"]))
    assert best["altitude_deg"] == pytest.approx(row["best_altitude_deg"], abs=0.05)


def test_moon_values_match_jpl_horizons():
    payload = plan(BERLIN, "2026-10-30", types=["nebula"], max_magnitude=9)
    # JPL Horizons, site 13.405E 52.52N: the Moon is at -0.0006 degrees at 18:40 UTC.
    assert minutes_between(payload["moon"]["windows"][0]["start_utc"], "2026-10-30T18:40:00Z") < 0.5
    # JPL Horizons: the Moon is at RA 105.948, Dec 25.625 at 02:05 UTC; the catalog gives M1 at RA 83.625, Dec 22.017.
    assert target(payload, "m1")["moon_separation_deg"] == pytest.approx(20.7, abs=0.2)
    assert 0 <= payload["moon"]["illuminated_fraction"] <= 1


def test_rank_is_by_time_above_the_minimum_altitude():
    rows = plan(BERLIN, "2026-10-30", limit=200, max_magnitude=8)["targets"]
    assert len(rows) > 20
    minutes = [row["minutes_above"] for row in rows]
    assert all(later <= earlier + 1 for earlier, later in zip(minutes, minutes[1:]))
    window_end = max(item["end_utc"] for row in rows for item in row["windows"])
    assert moment(window_end) == moment(plan(BERLIN, "2026-10-30", limit=1)["window"]["end_utc"])


def test_filters_select_type_magnitude_and_size():
    payload = plan(BERLIN, "2026-10-30", types=["galaxy"], max_magnitude=9, min_size_arcmin=10, max_size_arcmin=30, limit=200, min_altitude_deg=60)
    assert payload["targets"]
    for row in payload["targets"]:
        assert row["object_type"] == "galaxy" and row["magnitude"] <= 9 and 10 <= row["size_arcmin"] <= 30
        assert row["best_altitude_deg"] >= 60


def test_a_messier_object_is_not_listed_twice():
    keys = [row["key"] for row in target_catalog()]
    assert len(keys) == len(set(keys))
    assert "m42" in keys and "ngc-1976" not in keys and "ngc-224" not in keys


def test_the_response_does_not_hold_the_site():
    text = json.dumps(plan(BERLIN, "2026-10-30", limit=1))
    assert "13.405" not in text and "52.52" not in text and "latitude" not in text


@pytest.mark.parametrize("body", [
    {},
    [],
    {**BERLIN},
    {**BERLIN, "date": "soon"},
    {**BERLIN, "date": "1500-01-01"},
    {"latitude_deg": 91, "longitude_deg": 0, "date": "2026-10-30"},
    {"latitude_deg": 0, "longitude_deg": 181, "date": "2026-10-30"},
    {"latitude_deg": "0", "longitude_deg": 0, "date": "2026-10-30"},
    {**BERLIN, "date": "2026-10-30", "min_altitude_deg": 90},
    {**BERLIN, "date": "2026-10-30", "limit": 1000},
    {**BERLIN, "date": "2026-10-30", "types": ["spacecraft"]},
])
def test_invalid_requests_are_rejected(body):
    with pytest.raises(QueryInputError):
        night_plan_payload(body)
