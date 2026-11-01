"""Cuts matched sources out of an approved derivative for the depth flight.

The base image plus each sprite gives the derivative again, because the sprite holds
only the light above the filled sky. So the first frame of the flight is the photo.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import resource
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.community_sources import detect, read_rgb  # noqa: E402

import numpy as np  # noqa: E402

MAX_SPRITES = 120
CELL = 48
# A pair is exact inside this distance. The solution has no distortion terms, so its error grows to the edge.
MATCH_RADIUS_PIXELS = 3.0
MIN_ANCHORS = 4


def sky_to_pixel(wcs: dict, ra: float, dec: float) -> tuple[float, float] | None:
    """Pixels from the top left of the image, with the same conventions as Annotations.pixel."""
    rad = np.pi / 180
    dec0, delta, dec_r = wcs["dec_deg"] * rad, (ra - wcs["ra_deg"]) * rad, dec * rad
    denominator = np.sin(dec_r) * np.sin(dec0) + np.cos(dec_r) * np.cos(dec0) * np.cos(delta)
    if denominator <= 0:
        return None
    east = np.cos(dec_r) * np.sin(delta) / denominator / rad
    north = (np.sin(dec_r) * np.cos(dec0) - np.cos(dec_r) * np.sin(dec0) * np.cos(delta)) / denominator / rad
    scale, rotation = wcs["pixel_scale_arcsec"] / 3600, wcs["rotation_deg"] * rad
    a, b, c, d = wcs.get("cd") or [scale * np.cos(rotation), -scale * np.sin(rotation), scale * np.sin(rotation), scale * np.cos(rotation)]
    cx, cy = wcs.get("crpix") or [(wcs["width"] + 1) / 2, (wcs["height"] + 1) / 2]
    determinant = a * d - b * c
    if abs(determinant) < 1e-20:
        return None
    x = (d * east - b * north) / determinant + cx - 0.5
    y = wcs["height"] - ((-c * east + a * north) / determinant + cy - 0.5)
    return float(x), float(y)


def pair_sources(sources: list[dict], records: list[dict], wcs: dict, image_width: int, image_height: int) -> list[dict]:
    """Mutual nearest pairs inside the strict radius, after the removal of the median offset of the solution."""
    scale_x, scale_y = image_width / wcs["width"], image_height / wcs["height"]
    placed = []
    for record in records:
        pixel = sky_to_pixel(wcs, record["ra"], record["dec"])
        if pixel and 0 <= pixel[0] <= wcs["width"] and 0 <= pixel[1] <= wcs["height"]:
            placed.append((record, pixel[0] * scale_x, pixel[1] * scale_y))
    if not placed or not sources:
        return []
    positions = np.array([[source["x"], source["y"]] for source in sources])
    catalog = np.array([[x, y] for _, x, y in placed])
    distance = np.linalg.norm(positions[:, None, :] - catalog[None, :, :], axis=2)
    nearest = distance.argmin(axis=1)
    near = distance[np.arange(len(sources)), nearest] <= MATCH_RADIUS_PIXELS * 4
    offset = np.zeros(2)
    if np.count_nonzero(near) >= MIN_ANCHORS:
        offset = np.median(positions[near] - catalog[nearest[near]], axis=0)
    distance = np.linalg.norm(positions[:, None, :] - (catalog + offset)[None, :, :], axis=2)
    pairs = []
    for index in range(len(sources)):
        best = int(distance[index].argmin())
        if distance[index, best] <= MATCH_RADIUS_PIXELS and int(distance[:, best].argmin()) == index:
            pairs.append({"source": sources[index], "record": placed[best][0], "error_pixels": round(float(distance[index, best]), 2)})
    return pairs


def cut_layers(pixels: np.ndarray, pairs: list[dict]) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """The base image, the sprite sheet, and the place of each sprite on the sheet."""
    base = pixels.astype(np.int16).copy()
    height, width = pixels.shape[:2]
    chosen = sorted(pairs, key=lambda pair: -pair["source"]["flux"])[:MAX_SPRITES]
    columns = max(1, int(np.ceil(np.sqrt(len(chosen)))))
    rows = max(1, int(np.ceil(len(chosen) / columns)))
    sheet = np.zeros((rows * CELL, columns * CELL, 3), dtype=np.uint8)
    half = CELL // 2
    placed = []
    for index, pair in enumerate(chosen):
        x, y = int(round(pair["source"]["x"])), int(round(pair["source"]["y"]))
        if x < half or y < half or x + half > width or y + half > height:
            continue
        radius = min(half - 2, max(4.0, pair["source"]["width"] * 4))
        ys, xs = np.mgrid[y - half: y + half, x - half: x + half]
        distance = np.hypot(xs - x, ys - y)
        ring = (distance > radius) & (distance <= radius + 3)
        cut = base[y - half: y + half, x - half: x + half]
        fill = np.median(cut[ring], axis=0)
        inside = distance <= radius
        original = cut.copy()
        cut[inside] = np.minimum(original[inside], np.rint(fill).astype(np.int16))
        sprite = np.clip(original - cut, 0, 255).astype(np.uint8)
        row, column = index // columns, index % columns
        sheet[row * CELL: (row + 1) * CELL, column * CELL: (column + 1) * CELL] = sprite
        placed.append({**pair, "cell": [column, row], "center": [x + 0.0, y + 0.0]})
    return np.clip(base, 0, 255).astype(np.uint8), sheet, placed


def write_webp(pixels: np.ndarray, path: Path, options: str) -> None:
    raw = path.with_suffix(".raw")
    pixels.tofile(raw)
    height, width, bands = pixels.shape
    # The raw file comes from this script, and the block for untrusted input also stops this loader.
    environment = {name: value for name, value in os.environ.items() if name != "VIPS_BLOCK_UNTRUSTED"}
    subprocess.run(["vips", "rawload", str(raw), f"{path}{options}", str(width), str(height), str(bands)], check=True, capture_output=True, timeout=60, env=environment)
    raw.unlink()


def build(image: Path, request: dict, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    pixels = read_rgb(image, output)
    height, width = pixels.shape[:2]
    sources = detect(pixels.astype(np.float32).mean(axis=2), threshold_sigma=8.0, limit=1500)
    pairs = pair_sources(sources, request["records"], request["wcs"], width, height)
    base, sheet, placed = cut_layers(pixels, pairs)
    if placed:
        write_webp(base, output / "depth-base.webp", "[Q=92]")
        write_webp(sheet, output / "depth-sprites.webp", "[lossless]")
    return {
        "width": width,
        "height": height,
        "detected": len(sources),
        "cell": CELL,
        "sources": [{
            "key": item["record"]["key"],
            "name": item["record"]["name"],
            "x": item["center"][0] / width,
            "y": item["center"][1] / height,
            "cell": item["cell"],
            "distance_ly": item["record"]["distance_ly"],
            "distance_method": item["record"]["distance_method"],
            "error_pixels": item["error_pixels"],
        } for item in placed],
    }


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    try:
        request_data = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print(json.dumps(build(Path(sys.argv[1]), request_data, Path(sys.argv[3]))))
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)[:200]}))
        sys.exit(1)
