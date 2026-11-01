import math
from pathlib import Path

import numpy as np
import pytest

from backend.community_depth import sky_to_pixel, write_webp
from backend.community_sources import detect
from backend.community_sweep import classify, pixel_to_sky, reject_artifacts, sweep

WCS = {"ra_deg": 150.0, "dec_deg": 2.0, "pixel_scale_arcsec": 1.0, "rotation_deg": 25.0, "width": 1000, "height": 800}
SIZE = (800, 1000)


def source(ra, dec, flux=500.0):
    return {"ra": ra, "dec": dec, "flux": flux, "fx": 0.5, "fy": 0.5, "x": 1.0, "y": 1.0}


def survey_field(count=60, seed=2):
    rng = np.random.default_rng(seed)
    return [{"ra": 150 + float(a), "dec": 2 + float(b), "mag": 17 + float(c)} for a, b, c in zip(rng.uniform(-0.1, 0.1, count), rng.uniform(-0.1, 0.1, count), rng.uniform(0, 3, count))]


GALAXY = {"key": "ngc-3000", "name": "NGC 3000", "ra": 150.02, "dec": 2.02, "size_arcmin": 4.0}


def request(**changes):
    survey = survey_field()
    return {"dr11": survey, "gaia": [], "bodies": [], "transients": [], "galaxies": [GALAXY], "wcs": WCS, **changes}


def test_pixel_and_sky_are_inverse():
    for x, y in ((0.2, 0.3), (0.5, 0.5), (0.9, 0.85)):
        ra, dec = pixel_to_sky(WCS, x, y, 1000, 800)
        px, py = sky_to_pixel(WCS, ra, dec)
        assert px / 1000 == pytest.approx(x, abs=1e-6)
        assert py / 800 == pytest.approx(y, abs=1e-6)


def test_each_artifact_kind_is_rejected():
    good = {"x": 500.0, "y": 400.0, "flux": 900.0, "peak": 80.0, "width": 1.5, "elongation": 1.1, "pixels": 20}
    sources = [
        good,
        {**good, "width": 0.3, "pixels": 1},
        {**good, "elongation": 4.0},
        {**good, "x": 3.0},
        {**good, "x": 306.0, "y": 300.0, "peak": 60.0},
        {**good, "x": 300.0, "y": 300.0, "peak": 255.0, "flux": 60000.0, "width": 3.0},
    ]
    kept, counts = reject_artifacts(sources, 1000, 800)
    assert counts == {"hot_pixel": 1, "trail": 1, "edge": 1, "glare": 1}
    assert good in kept


def test_a_new_point_near_a_galaxy_is_a_candidate():
    survey = survey_field()
    sources = [source(row["ra"], row["dec"]) for row in survey] + [source(150.021, 2.021, 300.0)]
    result = classify(sources, request(dr11=survey))
    candidates = [row for row in result["findings"] if row["kind"] == "candidate"]
    assert len(candidates) == 1
    assert candidates[0]["near_key"] == "ngc-3000"
    assert candidates[0]["magnitude"] is not None


def test_a_new_point_far_from_each_galaxy_is_not_a_candidate():
    survey = survey_field()
    sources = [source(row["ra"], row["dec"]) for row in survey] + [source(150.09, 1.91, 300.0)]
    assert classify(sources, request(dr11=survey))["stats"]["candidates"] == 0


def test_a_known_transient_is_not_a_candidate():
    survey = survey_field()
    sources = [source(row["ra"], row["dec"]) for row in survey] + [source(150.021, 2.021)]
    result = classify(sources, request(dr11=survey, transients=[{"name": "ZTF20abc", "ra": 150.021, "dec": 2.021}]))
    assert result["stats"]["candidates"] == 0
    assert [row["designation"] for row in result["findings"]] == ["ZTF20abc"]


def test_a_gaia_star_or_a_known_body_is_not_a_candidate():
    survey = survey_field()
    sources = [source(row["ra"], row["dec"]) for row in survey] + [source(150.021, 2.021), source(150.019, 2.019)]
    result = classify(sources, request(dr11=survey, gaia=[{"ra": 150.021, "dec": 2.021}], bodies=[{"name": "(433) Eros", "ra": 150.019, "dec": 2.019, "magnitude": 12.0}]))
    assert result["stats"]["candidates"] == 0
    assert result["stats"]["bodies_recovered"] == 1
    assert result["findings"][0]["designation"] == "(433) Eros" and result["findings"][0]["recovered"]


def test_doubt_gives_no_candidates_but_keeps_known_bodies():
    bodies = [{"name": "(1) Ceres", "ra": 150.0, "dec": 2.0, "magnitude": 8.0}]
    survey = survey_field()
    sources = [source(row["ra"], row["dec"]) for row in survey] + [source(150.021, 2.021)]
    for changes, stop in (({"dr11": None}, "no_survey"), ({"dr11": survey[:5]}, "no_survey"), ({"transients": None}, "no_transient_list")):
        result = classify([dict(item) for item in sources], request(bodies=bodies, **({"dr11": survey} | changes)))
        assert result["stats"]["stop"] == stop
        assert [row["kind"] for row in result["findings"]] == ["known_body"]


def test_a_wrong_solution_gives_no_candidates():
    survey = survey_field()
    rng = np.random.default_rng(9)
    sources = [source(150 + float(a), 2 + float(b)) for a, b in zip(rng.uniform(-0.1, 0.1, 60), rng.uniform(-0.1, 0.1, 60))]
    result = classify(sources, request(dr11=survey))
    assert result["stats"]["stop"] == "survey_disagrees"


def test_too_many_points_give_no_candidates():
    survey = survey_field()
    extra = [source(150.02 + index * 0.0015, 2.02 + index * 0.0002) for index in range(24)]
    sources = [source(row["ra"], row["dec"]) for row in survey] + extra
    assert classify(sources, request(dr11=survey, galaxies=[{**GALAXY, "size_arcmin": 30.0}]))["stats"]["stop"] == "too_many"


def test_a_solution_offset_is_removed_before_the_match():
    survey = survey_field()
    shift = 6 / 3600
    sources = [source(row["ra"] + shift, row["dec"] - shift) for row in survey] + [source(150.021 + shift, 2.021 - shift)]
    assert classify(sources, request(dr11=survey))["stats"]["candidates"] == 1


def gaussian_field(stars, sky=30.0, noise=2.0, seed=3):
    rng = np.random.default_rng(seed)
    image = rng.normal(sky, noise, SIZE)
    ys, xs = np.mgrid[0:SIZE[0], 0:SIZE[1]]
    for x, y, peak in stars:
        left, right, top, bottom = max(int(x) - 12, 0), int(x) + 13, max(int(y) - 12, 0), int(y) + 13
        image[top:bottom, left:right] += peak * np.exp(-((xs[top:bottom, left:right] - x) ** 2 + (ys[top:bottom, left:right] - y) ** 2) / (2 * 1.7**2))
    return np.clip(image, 0, 255)


@pytest.mark.parametrize(("peak", "expected"), [(60.0, 0.95), (30.0, 0.9), (16.0, 0.6)])
def test_injected_points_are_recovered_at_each_brightness(peak, expected):
    rng = np.random.default_rng(int(peak))
    stars = [(float(a), float(b), peak) for a, b in zip(rng.uniform(60, 940, 60), rng.uniform(60, 740, 60))]
    found = detect(gaussian_field(stars), threshold_sigma=6.0)
    kept, _ = reject_artifacts(found, SIZE[1], SIZE[0])
    recovered = sum(any(math.hypot(item["x"] - x, item["y"] - y) < 2 for item in kept) for x, y, _ in stars)
    assert recovered / len(stars) >= expected


def test_the_script_runs_on_a_real_image_file(tmp_path: Path):
    rng = np.random.default_rng(5)
    stars = [(float(a), float(b), 80.0) for a, b in zip(rng.uniform(60, 940, 40), rng.uniform(60, 740, 40))]
    gray = gaussian_field(stars + [(300.0, 300.0, 80.0)]).astype(np.uint8)
    image = tmp_path / "master.webp"
    write_webp(np.repeat(gray[:, :, None], 3, axis=2), image, "[lossless]")
    survey = [dict(zip(("ra", "dec"), pixel_to_sky(WCS, (x + 0.5) / 1000, (y + 0.5) / 800, 1000, 800)), mag=17.0) for x, y, _ in stars]
    ra, dec = pixel_to_sky(WCS, 300.5 / 1000, 300.5 / 800, 1000, 800)
    result = sweep(image, request(dr11=survey, galaxies=[{"key": "g", "name": "G", "ra": ra, "dec": dec, "size_arcmin": 2.0}], gaia=[]), tmp_path / "scratch")
    candidates = [row for row in result["findings"] if row["kind"] == "candidate"]
    assert len(candidates) == 1
    assert candidates[0]["x"] == pytest.approx(0.3, abs=0.01)
    assert candidates[0]["near_key"] == "g"
    assert result["stats"]["sources"] >= 35
