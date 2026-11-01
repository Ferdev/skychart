import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from backend.community_depth import CELL, build, cut_layers, pair_sources, sky_to_pixel, write_webp
from backend.community_sources import detect, read_rgb

WCS = {"ra_deg": 150.0, "dec_deg": 2.0, "pixel_scale_arcsec": 2.0, "rotation_deg": 0.0, "width": 800, "height": 600}


def field(stars, width=800, height=600, sky=20, seed=4):
    rng = np.random.default_rng(seed)
    image = rng.normal(sky, 1.2, (height, width))
    ys, xs = np.mgrid[0:height, 0:width]
    for x, y, peak in stars:
        image += peak * np.exp(-((xs - x) ** 2 + (ys - y) ** 2) / (2 * 1.6**2))
    return np.clip(image, 0, 255)


def rgb(gray):
    return np.repeat(gray[:, :, None], 3, axis=2).astype(np.uint8)


def sky(x, y):
    """The inverse of sky_to_pixel near the center of the frame, by Newton steps."""
    ra, dec = 150.0, 2.0
    for _ in range(6):
        px, py = sky_to_pixel(WCS, ra, dec)
        ra2, dec2 = ra + 1e-3, dec + 1e-3
        dx = (sky_to_pixel(WCS, ra2, dec)[0] - px) / 1e-3
        dy = (sky_to_pixel(WCS, ra, dec2)[1] - py) / 1e-3
        ra += (x - px) / dx
        dec += (y - py) / dy
    return ra, dec


def test_detection_gives_centers_and_refuses_the_edge():
    stars = [(100, 120, 120), (400, 300, 90), (700, 500, 200), (3, 300, 200)]
    found = detect(field(stars))
    assert len(found) == 3
    assert min(abs(item["x"] - 400) + abs(item["y"] - 300) for item in found) < 0.5
    assert all(item["elongation"] < 1.4 for item in found)


def test_pairs_are_strict_and_a_solution_offset_is_removed():
    stars = [(100, 120), (400, 300), (700, 500), (250, 450), (600, 100)]
    sources = [{"x": x + 7.0, "y": y - 5.0, "flux": 10.0} for x, y in stars] + [{"x": 50.0, "y": 50.0, "flux": 5.0}]
    records = [{"key": f"r{index}", "name": "r", "ra": sky(x, y)[0], "dec": sky(x, y)[1], "distance_ly": 10.0, "distance_method": "parallax"} for index, (x, y) in enumerate(stars)]
    pairs = pair_sources(sources, records, WCS, 800, 600)
    assert sorted(pair["record"]["key"] for pair in pairs) == [f"r{index}" for index in range(5)]
    assert all(pair["error_pixels"] < 0.5 for pair in pairs)


def test_a_far_record_is_not_paired():
    sources = [{"x": 100.0, "y": 120.0, "flux": 10.0}]
    ra, dec = sky(110, 120)
    assert pair_sources(sources, [{"key": "r", "name": "r", "ra": ra, "dec": dec}], WCS, 800, 600) == []


def test_two_sources_cannot_share_one_record():
    sources = [{"x": 100.0, "y": 120.0, "flux": 10.0}, {"x": 102.0, "y": 120.0, "flux": 9.0}]
    ra, dec = sky(100.2, 120)
    pairs = pair_sources(sources, [{"key": "r", "name": "r", "ra": ra, "dec": dec}], WCS, 800, 600)
    assert [pair["source"]["x"] for pair in pairs] == [100.0]


def test_base_plus_sprites_gives_the_first_frame_again():
    stars = [(100, 120, 120), (400, 300, 90), (700, 500, 200)]
    pixels = rgb(field(stars))
    found = detect(pixels.astype(np.float32).mean(axis=2), threshold_sigma=8)
    pairs = [{"source": source, "record": {"key": str(index)}} for index, source in enumerate(found)]
    base, sheet, placed = cut_layers(pixels, pairs)
    assert len(placed) == 3
    rebuilt = base.astype(np.int32)
    half = CELL // 2
    for item in placed:
        x, y, (column, row) = int(item["center"][0]), int(item["center"][1]), item["cell"]
        rebuilt[y - half: y + half, x - half: x + half] += sheet[row * CELL: (row + 1) * CELL, column * CELL: (column + 1) * CELL]
    assert np.array_equal(rebuilt.astype(np.uint8), pixels)
    # The star left the base.
    assert base[120, 100, 0] < 40


def test_build_writes_webp_layers_and_fractions(tmp_path: Path):
    stars = [(100, 120, 120), (400, 300, 90), (700, 500, 200), (250, 450, 150)]
    image = tmp_path / "1600.webp"
    write_webp(rgb(field(stars)), image, "[Q=95]")
    records = [{"key": f"r{index}", "name": "r", "ra": sky(x, y)[0], "dec": sky(x, y)[1], "distance_ly": 10.0 + index, "distance_method": "parallax"} for index, (x, y, _) in enumerate(stars)]
    result = build(image, {"records": records, "wcs": WCS}, tmp_path / "out")
    assert len(result["sources"]) == 4
    assert result["sources"][0]["x"] == pytest.approx(700 / 800, abs=0.005)
    assert (tmp_path / "out" / "depth-base.webp").stat().st_size > 0
    assert read_rgb(tmp_path / "out" / "depth-sprites.webp", tmp_path).shape[2] == 3


def test_the_script_reports_a_bad_request(tmp_path: Path):
    script = Path(__file__).resolve().parents[1] / "backend" / "community_depth.py"
    request = tmp_path / "request.json"
    request.write_text(json.dumps({"records": []}), encoding="utf-8")
    run = subprocess.run([sys.executable, str(script), "missing.webp", str(request), str(tmp_path / "out")], capture_output=True, text=True)
    assert run.returncode == 1
    assert "error" in json.loads(run.stdout)
