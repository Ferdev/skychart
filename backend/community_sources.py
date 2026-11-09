"""Point sources of one image, with numpy only. The depth worker and the sweep both use it."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

# The same limits as community_media.py: one decoder thread is what fits under the memory limit.
os.environ.update(VIPS_CONCURRENCY="1", VIPS_BLOCK_UNTRUSTED="1", VIPS_DISC_THRESHOLD="32m", OPENBLAS_NUM_THREADS="1")

import numpy as np  # noqa: E402

EDGE_PIXELS = 12
BLOCK_PIXELS = 64
# The same pixel limit as an upload in community_media.py.
MAX_PIXELS = 120_000_000


class ImageTooLarge(ValueError):
    """The image has more pixels than the limit, so it is not decoded at full resolution."""


def header(source: str, field: str) -> int:
    return int(subprocess.run(["vipsheader", "-f", field, source], check=True, capture_output=True, timeout=10).stdout)


def read_rgb(image: Path, scratch: Path, size: int | None = None, max_pixels: int = MAX_PIXELS) -> np.ndarray:
    """Decodes an image to a height x width x 3 array of bytes with vips. A `size` reduces the long side.

    An image with more than `max_pixels` pixels gives `ImageTooLarge` before any decode, also before
    the reduction to `size`.
    """
    source = str(image)
    # vipsheader reads only the header, so this check costs no decode. It reads the original, so
    # that a decompression bomb does not reach `vips thumbnail` either.
    source_width, source_height = header(source, "width"), header(source, "height")
    if source_width <= 0 or source_height <= 0 or source_width * source_height > max_pixels:
        raise ImageTooLarge(f"Image of {source_width} x {source_height} pixels exceeds {max_pixels} pixels")
    if size:
        small = scratch / "small.png"
        subprocess.run(["vips", "thumbnail", source, str(small), str(size), "--height", str(size), "--size", "down"], check=True, capture_output=True, timeout=60)
        source = str(small)
    flat = scratch / "flat.png"
    # `flatten` takes the last band as alpha, also in an opaque image. So it runs only when an alpha exists.
    source_bands = header(source, "bands")
    subprocess.run(["vips", "flatten" if source_bands in (2, 4) else "copy", source, str(flat)], check=True, capture_output=True, timeout=60)
    width = int(subprocess.run(["vipsheader", "-f", "width", str(flat)], check=True, capture_output=True, timeout=10).stdout)
    height = int(subprocess.run(["vipsheader", "-f", "height", str(flat)], check=True, capture_output=True, timeout=10).stdout)
    bands = int(subprocess.run(["vipsheader", "-f", "bands", str(flat)], check=True, capture_output=True, timeout=10).stdout)
    raw = scratch / "image.raw"
    subprocess.run(["vips", "cast", str(flat), str(scratch / "byte.png"), "uchar", "--shift"], check=True, capture_output=True, timeout=60)
    subprocess.run(["vips", "rawsave", str(scratch / "byte.png"), str(raw)], check=True, capture_output=True, timeout=60)
    pixels = np.fromfile(raw, dtype=np.uint8).reshape(height, width, bands)
    return pixels if bands >= 3 else np.repeat(pixels[:, :, :1], 3, axis=2)


def background(gray: np.ndarray) -> tuple[np.ndarray, float]:
    """A smooth sky level from medians of blocks, and the noise of the sky."""
    height, width = gray.shape
    rows, columns = max(1, height // BLOCK_PIXELS), max(1, width // BLOCK_PIXELS)
    blocks = np.zeros((rows, columns), dtype=np.float32)
    for row in range(rows):
        for column in range(columns):
            blocks[row, column] = np.median(gray[row * BLOCK_PIXELS: (row + 1) * BLOCK_PIXELS, column * BLOCK_PIXELS: (column + 1) * BLOCK_PIXELS])
    up_rows = np.minimum(np.arange(height) // BLOCK_PIXELS, rows - 1)
    up_columns = np.minimum(np.arange(width) // BLOCK_PIXELS, columns - 1)
    level = blocks[np.ix_(up_rows, up_columns)]
    residual = (gray - level).ravel()[:: max(1, gray.size // 200_000)]
    sigma = float(np.median(np.abs(residual)) * 1.4826)
    return level, max(sigma, 0.5)


def detect(gray: np.ndarray, threshold_sigma: float = 6.0, limit: int = 3000) -> list[dict[str, float]]:
    """Local maxima above the sky, with a center, a flux, the widths of the source, and its elongation."""
    level, sigma = background(gray)
    signal = gray - level
    height, width = gray.shape
    mask = signal > threshold_sigma * sigma
    mask[:EDGE_PIXELS, :] = mask[-EDGE_PIXELS:, :] = False
    mask[:, :EDGE_PIXELS] = mask[:, -EDGE_PIXELS:] = False
    rows, columns = np.nonzero(mask)
    order = np.argsort(-signal[rows, columns])
    taken = np.zeros_like(mask)
    found: list[dict[str, float]] = []
    for index in order:
        row, column = int(rows[index]), int(columns[index])
        if taken[row, column]:
            continue
        box = 6
        top, bottom, left, right = row - box, row + box + 1, column - box, column + box + 1
        if top < 0 or left < 0 or bottom > height or right > width:
            continue
        cut = np.clip(signal[top:bottom, left:right], 0, None)
        cut = np.where(cut > 0.25 * signal[row, column], cut, 0)
        total = float(cut.sum())
        if total <= 0:
            continue
        ys, xs = np.mgrid[top:bottom, left:right]
        center_x, center_y = float((cut * xs).sum() / total), float((cut * ys).sum() / total)
        xx = float((cut * (xs - center_x) ** 2).sum() / total)
        yy = float((cut * (ys - center_y) ** 2).sum() / total)
        xy = float((cut * (xs - center_x) * (ys - center_y)).sum() / total)
        spread = np.sqrt(max(((xx - yy) / 2) ** 2 + xy**2, 0.0))
        major, minor = (xx + yy) / 2 + spread, max((xx + yy) / 2 - spread, 1e-6)
        taken[max(top, 0): bottom, max(left, 0): right] = True
        found.append({
            "x": center_x,
            "y": center_y,
            "flux": total,
            "peak": float(gray[row, column]),
            "width": float(np.sqrt(major)),
            "elongation": float(np.sqrt(major / minor)),
            "pixels": int(np.count_nonzero(cut)),
        })
        if len(found) >= limit:
            break
    return found
