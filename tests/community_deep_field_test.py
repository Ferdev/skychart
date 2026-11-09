import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import numpy as np
import pytest

from backend.community_deep_field import add_weights, build, combine, fit_tone, limiting_magnitude, linearize, pixel_to_sky, sky_to_frame
from backend.community_depth import sky_to_pixel, write_webp

SCALE = 4.0 / 3600
GRID = {
    "ra_deg": 150.0,
    "dec_deg": 2.0,
    "width": 400,
    "height": 300,
    "cd": [-SCALE, 0.0, 0.0, SCALE],
    "crpix": [200.5, 150.5],
}


def frame_wcs(ra=150.0, dec=2.0, angle=0.0, flip=False):
    cosine, sine = np.cos(np.radians(angle)), np.sin(np.radians(angle))
    east = -SCALE if not flip else SCALE
    return {
        "ra_deg": ra,
        "dec_deg": dec,
        "pixel_scale_arcsec": 4.0,
        "rotation_deg": angle,
        "width": 400,
        "height": 300,
        "cd": [east * cosine, -SCALE * sine, east * sine, SCALE * cosine],
        "crpix": [200.5, 150.5],
        "status": "solved",
    }


def star_field(count=60, seed=7):
    rng = np.random.default_rng(seed)
    stars = []
    while len(stars) < count:
        x, y = rng.uniform(30, 370), rng.uniform(30, 270)
        if all(np.hypot(x - star["x"], y - star["y"]) > 16 for star in stars):
            ra, dec = pixel_to_sky(GRID, np.array([x]), np.array([y]))
            stars.append({"x": x, "y": y, "ra": float(ra[0]), "dec": float(dec[0]), "magnitude": float(rng.uniform(4.5, 8.5)), "key": f"s{len(stars)}", "name": "star", "distance_ly": 10.0, "distance_method": "parallax"})
    return stars


def render(stars, wcs, gamma, scale, sky_level, noise, seed, sigma=1.5):
    """A processed frame: linear light, then a tone curve, then 8 bits."""
    rng = np.random.default_rng(seed)
    linear = np.zeros((300, 400), dtype=np.float64)
    ys, xs = np.mgrid[0:300, 0:400]
    for star in stars:
        x, y = sky_to_pixel(wcs, star["ra"], star["dec"])
        linear += 10 ** (-0.4 * star["magnitude"]) * np.exp(-((xs + 0.5 - x) ** 2 + (ys + 0.5 - y) ** 2) / (2 * sigma**2))
    linear += rng.normal(0, noise, linear.shape)
    curved = np.sign(linear) * np.abs(linear) ** gamma * scale
    return np.clip(curved + sky_level, 0, 255)


def save(gray, path):
    write_webp(np.repeat(np.rint(gray)[:, :, None], 3, axis=2).astype(np.uint8), path, "[lossless]")


def request(tmp_path, stars, specs):
    frames = []
    for index, (wcs, image) in enumerate(specs):
        path = tmp_path / f"frame-{index}.webp"
        save(image, path)
        frames.append({"id": f"frame-{index}", "path": str(path), "wcs": wcs})
    return {"grid": GRID, "stars": stars, "frames": frames}


def crafted_png(path, width, height):
    """A PNG whose header gives a large size, with almost no data."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"\0" * 64)) + chunk(b"IEND", b""))
    return path


def test_pixel_to_sky_is_the_inverse_of_the_frame_projection():
    wcs = {**GRID}
    xs, ys = np.array([0.5, 200.5, 399.5]), np.array([0.5, 150.0, 299.5])
    ra, dec = pixel_to_sky(GRID, xs, ys)
    x, y = sky_to_frame(wcs, ra, dec)
    assert np.allclose(x, xs, atol=1e-6)
    assert np.allclose(y, ys, atol=1e-6)


def test_tone_fit_recovers_the_curve_of_a_stretched_frame():
    magnitudes = np.linspace(5, 11, 30)
    peaks = 900.0 * (10 ** (-0.4 * magnitudes)) ** 0.45
    fitted = fit_tone(peaks, magnitudes)
    assert fitted is not None
    assert fitted[0] == pytest.approx(900, rel=1e-3)
    assert fitted[1] == pytest.approx(0.45, abs=1e-3)


def test_tone_fit_needs_stars_of_different_brightness():
    assert fit_tone(np.full(20, 80.0), np.full(20, 8.0)) is None
    assert fit_tone(np.array([10.0, 20.0]), np.array([7.0, 9.0])) is None


def test_linearize_keeps_the_sign_of_the_noise():
    rng = np.random.default_rng(1)
    pixels = np.clip(rng.normal(40, 4, (128, 128, 3)), 0, 255).astype(np.uint8)
    linear = linearize(pixels, scale=100.0, gamma=0.5)
    assert (linear < 0).any() and (linear > 0).any()
    assert abs(float(np.median(linear))) < 1e-3


def test_weights_prefer_low_noise_and_sharp_stars_and_add_up_to_one():
    frames = [{"noise": 1.0, "sharpness_pixels": 2.0}, {"noise": 2.0, "sharpness_pixels": 2.0}, {"noise": 1.0, "sharpness_pixels": 4.0}]
    add_weights(frames)
    assert sum(frame["weight"] for frame in frames) == pytest.approx(1.0)
    assert frames[0]["weight"] > frames[1]["weight"]
    assert frames[0]["weight"] > frames[2]["weight"]
    assert frames[1]["weight"] == pytest.approx(frames[2]["weight"])


def test_sigma_clip_removes_a_trail_that_only_one_frame_has(tmp_path):
    rng = np.random.default_rng(3)
    shape = (40, 60)
    frames = []
    for index in range(12):
        image = rng.normal(0, 1, (*shape, 3)).astype(np.float32)
        if index == 0:
            image[20, :, :] = 80
        path = tmp_path / f"{index}.npy"
        np.save(path, image)
        frames.append({"path": path, "weight": 1 / 12})
    stack, depth = combine(frames, shape)
    assert abs(float(stack[20].mean())) < 1.5
    assert depth[20].max() <= 11
    assert depth[5].max() == 12


def noise_frames(tmp_path, count, shape, seed=5):
    """Frames of sky noise with a deviation of 1 in each band, as the stacker measures it."""
    rng = np.random.default_rng(seed)
    frames = []
    for index in range(count):
        path = tmp_path / f"noise-{index}.npy"
        np.save(path, rng.normal(0, 1, (*shape, 3)).astype(np.float32))
        frames.append({"path": path, "weight": 1 / count, "noise": 1 / np.sqrt(3)})
    return frames


def test_three_frames_remove_a_hot_pixel_of_one_frame(tmp_path):
    shape = (20, 30)
    frames = noise_frames(tmp_path, 3, shape)
    hot = np.load(frames[0]["path"])
    hot[10, 12, :] = 80
    np.save(frames[0]["path"], hot)
    others = [np.load(frame["path"])[10, 12] for frame in frames[1:]]
    stack, depth = combine(frames, shape)
    assert np.allclose(stack[10, 12], np.mean(others, axis=0), atol=1e-5)
    assert depth[10, 12] == 2


def test_a_trail_of_one_frame_leaves_a_small_stack(tmp_path):
    shape = (40, 60)
    frames = noise_frames(tmp_path, 4, shape)
    trail = np.load(frames[2]["path"])
    trail[20, :, :] = 40
    np.save(frames[2]["path"], trail)
    stack, depth = combine(frames, shape)
    assert abs(float(stack[20].mean())) < 1.5
    assert depth[20].max() <= 3


def test_noise_alone_keeps_nearly_all_values(tmp_path):
    shape = (100, 100)
    for count in (3, 5):
        frames = noise_frames(tmp_path, count, shape, seed=count)
        _, depth = combine(frames, shape)
        # A 3-sigma test keeps 99.7 % of normal values. A frame counts in the depth with its 3 bands.
        assert float(depth.mean()) / count > 0.99


def test_two_frames_are_never_clipped(tmp_path):
    shape = (8, 8)
    frames = []
    for index, value in enumerate([0.0, 10.0]):
        path = tmp_path / f"{index}.npy"
        np.save(path, np.full((*shape, 3), value, dtype=np.float32))
        frames.append({"path": path, "weight": 0.5})
    stack, depth = combine(frames, shape)
    assert np.allclose(stack, 5.0)
    assert depth.max() == 2


def test_stack_is_deeper_than_the_best_single_frame(tmp_path):
    """The check of the proposal: the stack beats the best frame by at least 0.5 magnitudes."""
    stars = star_field()
    specs = []
    for index in range(9):
        wcs = frame_wcs(ra=150.0 + 0.004 * (index - 4), dec=2.0 + 0.003 * (4 - index), angle=index * 1.5, flip=index % 3 == 0)
        gamma = [0.5, 0.42, 0.6][index % 3]
        specs.append((wcs, render(stars, wcs, gamma, 900.0, 30 + index, 0.00002, seed=index)))
    result = build(request(tmp_path, stars, specs), tmp_path / "out", tmp_path / "scratch")

    assert result["rejected"] == []
    assert len(result["frames"]) == 9
    assert result["gain_mag"] >= 0.5
    assert result["limiting_mag"] > result["best_limiting_mag"]
    assert result["stars_recovered"] >= result["best_stars_recovered"]
    assert result["max_coverage"] == 9
    assert sum(frame["weight"] for frame in result["frames"]) == pytest.approx(1.0)
    for name in ["stack", "best", "depth", "thumb"]:
        assert (tmp_path / "out" / f"{name}.webp").stat().st_size > 0


def test_one_frame_that_cannot_be_used_keeps_a_reason_and_the_others_build(tmp_path):
    stars = star_field()
    specs = []
    for index in range(4):
        wcs = frame_wcs(ra=150.0 + 0.002 * index)
        specs.append((wcs, render(stars, wcs, 0.5, 900.0, 30, 0.00002, seed=index)))
    specs.append((frame_wcs(), np.random.default_rng(9).normal(30, 2, (300, 400))))
    result = build(request(tmp_path, stars, specs), tmp_path / "out", tmp_path / "scratch")
    assert result["rejected"] == [{"id": "frame-4", "reason": "too_few_stars"}]
    assert len(result["frames"]) == 4


def test_a_frame_above_the_pixel_limit_keeps_a_reason_and_the_others_build(tmp_path):
    stars = star_field()
    specs = []
    for index in range(3):
        wcs = frame_wcs(ra=150.0 + 0.002 * index)
        specs.append((wcs, render(stars, wcs, 0.5, 900.0, 30, 0.00002, seed=index)))
    data = request(tmp_path, stars, specs)
    bomb = crafted_png(tmp_path / "bomb.png", 20_000, 20_000)
    data["frames"].append({"id": "frame-bomb", "path": str(bomb), "wcs": frame_wcs()})
    result = build(data, tmp_path / "out", tmp_path / "scratch")
    assert result["rejected"] == [{"id": "frame-bomb", "reason": "too_large"}]
    assert len(result["frames"]) == 3


def test_a_build_with_too_few_frames_writes_no_image(tmp_path):
    stars = star_field()
    wcs = frame_wcs()
    result = build(request(tmp_path, stars, [(wcs, render(stars, wcs, 0.5, 900.0, 30, 0.00002, seed=1))]), tmp_path / "out", tmp_path / "scratch")
    assert result["stop"] == "too_few_frames"
    assert not (tmp_path / "out" / "stack.webp").exists()


def test_limiting_magnitude_grows_when_the_noise_falls():
    rng = np.random.default_rng(2)
    noisy, quiet = rng.normal(0, 1e-3, (200, 200)), rng.normal(0, 2.5e-4, (200, 200))
    assert limiting_magnitude(quiet) - limiting_magnitude(noisy) == pytest.approx(2.5 * np.log10(4), abs=0.1)


def test_command_line_reports_a_bad_request_as_json(tmp_path):
    bad = tmp_path / "request.json"
    bad.write_text(json.dumps({"frames": []}), encoding="utf-8")
    script = Path(__file__).resolve().parents[1] / "backend" / "community_deep_field.py"
    done = subprocess.run([sys.executable, str(script), str(bad), str(tmp_path / "out"), str(tmp_path / "scratch")], capture_output=True, text=True, timeout=60)
    assert done.returncode == 1
    assert "error" in json.loads(done.stdout)
