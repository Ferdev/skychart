"""Stacks approved solved photos of one target on one shared tangent-plane grid.

Each frame is a processed image, so the script first brings it back near linear light. The
peaks of Gaia stars in the frame give a tone curve (a power law) and the blocks of the sky
give the background. After this step one unit of pixel value has the same meaning in each
frame: the peak of a star of magnitude 0. This is an estimate for a picture, not photometry.

Memory stays flat with the number of frames: an aligned frame waits on disk, and two passes
over these files keep only the running sums in memory.
"""
from __future__ import annotations

import json
from pathlib import Path
import resource
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.community_depth import pair_sources, sky_to_pixel, write_webp  # noqa: E402
from backend.community_sources import ImageTooLarge, background, detect, read_rgb  # noqa: E402

import numpy as np  # noqa: E402

MIN_FRAMES = 2
MIN_STARS = 6
# A tone curve needs a range of brightness, or the slope has no meaning.
MIN_MAGNITUDE_RANGE = 1.0
GAMMA_RANGE = (0.15, 1.6)
SATURATED_LEVEL = 245.0
MAX_ELONGATION = 2.0
MAX_ALIGNMENT_ERROR_PIXELS = 2.0
MIN_OVERLAP = 0.1
CLIP_SIGMA = 3.0
# Each pixel needs this many frames before a clip can remove a value: two values have no outlier.
MIN_CLIP_FRAMES = 3
LIMIT_SIGMA = 5.0
LIMIT_PIXEL_SAMPLES = 400_000


def pixel_to_sky(grid: dict, xs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The inverse of `sky_to_pixel`, for the arrays of a whole grid."""
    rad = np.pi / 180
    a, b, c, d = grid["cd"]
    cx, cy = grid["crpix"]
    u, v = xs - cx + 0.5, grid["height"] - ys - cy + 0.5
    east, north = (a * u + b * v) * rad, (c * u + d * v) * rad
    radius = np.hypot(east, north)
    angle = np.arctan(radius)
    dec0, ra0 = grid["dec_deg"] * rad, grid["ra_deg"] * rad
    sine, cosine = np.sin(angle), np.cos(angle)
    # Division by zero is only at the reference point, and the limit of the term is north itself.
    ratio = np.divide(sine, radius, out=np.ones_like(radius), where=radius > 0)
    dec = np.arcsin(np.clip(cosine * np.sin(dec0) + north * ratio * np.cos(dec0), -1, 1))
    ra = ra0 + np.arctan2(east * ratio, np.cos(dec0) * cosine - north * ratio * np.sin(dec0))
    return ra / rad, dec / rad


def sky_to_frame(wcs: dict, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """`sky_to_pixel` for arrays. A direction behind the tangent plane is NaN."""
    rad = np.pi / 180
    dec0, delta, dec_r = wcs["dec_deg"] * rad, (ra - wcs["ra_deg"]) * rad, dec * rad
    denominator = np.sin(dec_r) * np.sin(dec0) + np.cos(dec_r) * np.cos(dec0) * np.cos(delta)
    denominator = np.where(denominator > 0, denominator, np.nan)
    east = np.cos(dec_r) * np.sin(delta) / denominator / rad
    north = (np.sin(dec_r) * np.cos(dec0) - np.cos(dec_r) * np.sin(dec0) * np.cos(delta)) / denominator / rad
    a, b, c, d = wcs["cd"]
    cx, cy = wcs["crpix"]
    determinant = a * d - b * c
    x = (d * east - b * north) / determinant + cx - 0.5
    y = wcs["height"] - ((-c * east + a * north) / determinant + cy - 0.5)
    return x, y


def fit_tone(peaks: np.ndarray, magnitudes: np.ndarray) -> tuple[float, float] | None:
    """A robust fit of log10(peak) = log10(A) + gamma * log10(flux). It returns (A, gamma)."""
    log_flux = -0.4 * magnitudes
    log_peak = np.log10(peaks)
    keep = np.ones_like(log_peak, dtype=bool)
    slope, offset = 0.0, 0.0
    for _ in range(4):
        if np.count_nonzero(keep) < MIN_STARS or np.ptp(magnitudes[keep]) < MIN_MAGNITUDE_RANGE:
            return None
        slope, offset = np.polyfit(log_flux[keep], log_peak[keep], 1)
        residual = log_peak - (slope * log_flux + offset)
        spread = max(float(np.median(np.abs(residual[keep]))) * 1.4826, 0.02)
        keep = np.abs(residual) <= 2.5 * spread
    if not GAMMA_RANGE[0] <= slope <= GAMMA_RANGE[1]:
        return None
    return float(10**offset), float(slope)


def linearize(pixels: np.ndarray, scale: float, gamma: float) -> np.ndarray:
    """Removes the background of each band and undoes the tone curve. Noise stays signed."""
    bands = []
    for band in range(3):
        channel = pixels[:, :, band].astype(np.float32)
        level, _ = background(channel)
        signal = (channel - level) / scale
        bands.append(np.sign(signal) * np.abs(signal) ** (1 / gamma))
    return np.stack(bands, axis=2).astype(np.float32)


def alignment(pairs: list[dict], wcs: dict, width: int, height: int) -> tuple[np.ndarray, float] | None:
    """An affine correction from the solution to the detected stars, and its median error in pixels."""
    scale_x, scale_y = width / wcs["width"], height / wcs["height"]
    placed, seen = [], []
    for pair in pairs:
        pixel = sky_to_pixel(wcs, pair["record"]["ra"], pair["record"]["dec"])
        if pixel:
            placed.append([pixel[0] * scale_x, pixel[1] * scale_y, 1.0])
            seen.append([pair["source"]["x"], pair["source"]["y"]])
    if len(placed) < MIN_STARS:
        return None
    design, target = np.array(placed), np.array(seen)
    matrix = np.linalg.lstsq(design, target, rcond=None)[0]
    error = np.linalg.norm(design @ matrix - target, axis=1)
    return matrix, float(np.median(error))


def reproject(linear: np.ndarray, wcs: dict, matrix: np.ndarray, grid: dict, ra: np.ndarray, dec: np.ndarray) -> np.ndarray:
    """Samples a frame at the sky position of each grid pixel, with bilinear interpolation."""
    height, width = linear.shape[:2]
    x, y = sky_to_frame(wcs, ra, dec)
    placed = np.stack([x * width / wcs["width"], y * height / wcs["height"], np.ones_like(x)], axis=2)
    corrected = placed @ matrix
    xs, ys = corrected[:, :, 0], corrected[:, :, 1]
    inside = (xs >= 0) & (ys >= 0) & (xs <= width - 1.001) & (ys <= height - 1.001)
    x0 = np.where(inside, xs, 0).astype(np.int32)
    y0 = np.where(inside, ys, 0).astype(np.int32)
    fx = (np.where(inside, xs, 0) - x0).astype(np.float32)[:, :, None]
    fy = (np.where(inside, ys, 0) - y0).astype(np.float32)[:, :, None]
    aligned = (
        linear[y0, x0] * (1 - fx) * (1 - fy)
        + linear[y0, x0 + 1] * fx * (1 - fy)
        + linear[y0 + 1, x0] * (1 - fx) * fy
        + linear[y0 + 1, x0 + 1] * fx * fy
    )
    aligned[~inside] = np.nan
    return aligned.astype(np.float32)


def prepare(frame: dict, stars: list[dict], grid: dict, ra: np.ndarray, dec: np.ndarray, scratch: Path) -> dict:
    """One frame on the grid with its scores, or the reason that the frame stays out."""
    folder = scratch / frame["id"]
    folder.mkdir()
    try:
        pixels = read_rgb(Path(frame["path"]), folder)
    except ImageTooLarge:
        return {"id": frame["id"], "reason": "too_large"}
    height, width = pixels.shape[:2]
    gray = pixels.astype(np.float32).mean(axis=2)
    level, _ = background(gray)
    sources = detect(gray, threshold_sigma=6.0, limit=800)
    pairs = pair_sources(sources, stars, frame["wcs"], width, height)
    # Trailing removes the long stars from `good`, so this check comes first and gives the true reason.
    if pairs and float(np.median([pair["source"]["elongation"] for pair in pairs])) > MAX_ELONGATION:
        return {"id": frame["id"], "reason": "trailed_stars"}
    good = [pair for pair in pairs if pair["source"]["peak"] < SATURATED_LEVEL and pair["source"]["elongation"] <= MAX_ELONGATION]
    if len(good) < MIN_STARS:
        return {"id": frame["id"], "reason": "too_few_stars"}
    fitted = alignment(good, frame["wcs"], width, height)
    if fitted is None or fitted[1] > MAX_ALIGNMENT_ERROR_PIXELS:
        return {"id": frame["id"], "reason": "poor_alignment"}
    peaks = np.array([pair["source"]["peak"] - level[int(pair["source"]["y"]), int(pair["source"]["x"])] for pair in good])
    magnitudes = np.array([pair["record"]["magnitude"] for pair in good], dtype=np.float64)
    usable = peaks > 0
    tone = fit_tone(peaks[usable], magnitudes[usable]) if np.count_nonzero(usable) >= MIN_STARS else None
    if tone is None:
        return {"id": frame["id"], "reason": "no_tone_fit"}
    linear = linearize(pixels, *tone)
    aligned = reproject(linear, frame["wcs"], fitted[0], grid, ra, dec)
    overlap = float(np.mean(np.isfinite(aligned[:, :, 0])))
    if overlap < MIN_OVERLAP:
        return {"id": frame["id"], "reason": "outside_field"}
    noise = sky_noise(linear.mean(axis=2))
    if not np.isfinite(noise) or noise <= 0:
        return {"id": frame["id"], "reason": "no_noise_measure"}
    path = scratch / f"{frame['id']}.npy"
    np.save(path, aligned)
    return {
        "id": frame["id"],
        "path": path,
        "noise": noise,
        "sharpness_pixels": float(np.median([pair["source"]["width"] for pair in good])),
        "gamma": tone[1],
        "stars": len(good),
        "overlap": overlap,
    }


def add_weights(frames: list[dict]) -> None:
    """Inverse variance, reduced for soft stars. The weights of the frames add up to one."""
    sharpest = min(frame["sharpness_pixels"] for frame in frames)
    raw = [(sharpest / frame["sharpness_pixels"]) ** 2 / frame["noise"] ** 2 for frame in frames]
    total = sum(raw)
    for frame, value in zip(frames, raw):
        frame["weight"] = value / total


def combine(frames: list[dict], shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """A weighted mean with a sigma clip, by two passes over the frames on disk."""
    height, width = shape
    weight_sum = np.zeros((height, width, 3), dtype=np.float32)
    first = np.zeros((height, width, 3), dtype=np.float32)
    second = np.zeros((height, width, 3), dtype=np.float32)
    count = np.zeros((height, width), dtype=np.uint16)
    for frame in frames:
        aligned = np.load(frame["path"])
        valid = np.isfinite(aligned)
        values = np.where(valid, aligned, 0)
        weight_sum += valid * np.float32(frame["weight"])
        first += values * np.float32(frame["weight"])
        second += values * values * np.float32(frame["weight"])
        count += valid[:, :, 0].astype(np.uint16)
    mean = np.divide(first, weight_sum, out=np.zeros_like(first), where=weight_sum > 0)
    variance = np.divide(second, weight_sum, out=np.zeros_like(second), where=weight_sum > 0) - mean**2
    limit = CLIP_SIGMA * np.sqrt(np.clip(variance, 0, None))
    clip_allowed = (count >= MIN_CLIP_FRAMES)[:, :, None]

    kept_weight = np.zeros((height, width, 3), dtype=np.float32)
    kept_sum = np.zeros((height, width, 3), dtype=np.float32)
    depth = np.zeros((height, width), dtype=np.uint16)
    for frame in frames:
        aligned = np.load(frame["path"])
        valid = np.isfinite(aligned)
        kept = valid & (~clip_allowed | (np.abs(np.where(valid, aligned, mean) - mean) <= limit))
        kept_weight += kept * np.float32(frame["weight"])
        kept_sum += np.where(kept, aligned, 0) * np.float32(frame["weight"])
        depth += kept.all(axis=2).astype(np.uint16)
    stack = np.divide(kept_sum, kept_weight, out=np.full_like(kept_sum, np.nan), where=kept_weight > 0)
    return stack, depth


def sky_noise(gray: np.ndarray) -> float:
    """The scatter of the sky. A processed image can have a flat black sky, so the median deviation can be zero."""
    values = gray[np.isfinite(gray)]
    values = values[:: max(1, values.size // LIMIT_PIXEL_SAMPLES)]
    if not values.size:
        return 0.0
    center = float(np.median(values))
    deviation = float(np.median(np.abs(values - center))) * 1.4826
    if deviation > 0:
        return deviation
    # The stars are in the upper tail, so this measure ignores it.
    sky = values[values <= np.percentile(values, 98)]
    return float(sky.std())


def limiting_magnitude(gray: np.ndarray) -> float | None:
    """The magnitude of a star with a peak of five times the noise of the sky."""
    noise = sky_noise(gray)
    return float(-2.5 * np.log10(LIMIT_SIGMA * noise)) if noise > 0 else None


def stretch(linear: np.ndarray, softness: float, white: float) -> np.ndarray:
    """An asinh stretch. The stack and the single frame use one scale, so that the slider is honest."""
    image = np.arcsinh(np.nan_to_num(np.clip(linear, 0, None)) / softness) / np.arcsinh(white / softness)
    return (np.clip(image, 0, 1) * 255).astype(np.uint8)


def recovered_stars(gray: np.ndarray, stars: list[dict], grid: dict) -> int:
    """Gaia stars that a 5-sigma detection finds at their place on the grid."""
    noise = sky_noise(gray)
    if noise <= 0:
        return 0
    found = detect(np.nan_to_num(gray) / noise, threshold_sigma=LIMIT_SIGMA, limit=2000)
    # The grid has a CD matrix, so `sky_to_pixel` reads no value from these two fields.
    solution = {"pixel_scale_arcsec": 0.0, "rotation_deg": 0.0, **grid}
    return len(pair_sources(found, stars, solution, grid["width"], grid["height"]))


def build(request: dict, output: Path, scratch: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    grid = request["grid"]
    height, width = grid["height"], grid["width"]
    ys, xs = np.mgrid[0:height, 0:width]
    ra, dec = pixel_to_sky(grid, xs + 0.5, ys + 0.5)

    prepared = [prepare(frame, request["stars"], grid, ra, dec, scratch) for frame in request["frames"]]
    frames = [item for item in prepared if "reason" not in item]
    rejected = [{"id": item["id"], "reason": item["reason"]} for item in prepared if "reason" in item]
    result = {"width": width, "height": height, "rejected": rejected}
    if len(frames) < MIN_FRAMES:
        return {**result, "frames": [], "stop": "too_few_frames"}

    add_weights(frames)
    stack, depth = combine(frames, (height, width))
    best = max(frames, key=lambda frame: frame["weight"])
    single = np.load(best["path"])

    # Both measures use the pixels of the single frame, so the stack has no gain from another sky area.
    shared = np.isfinite(single[:, :, 0]) & np.isfinite(stack[:, :, 0])
    stack_gray = np.where(shared, stack.mean(axis=2), np.nan)
    single_gray = np.where(shared, single.mean(axis=2), np.nan)
    limit, best_limit = limiting_magnitude(stack_gray), limiting_magnitude(single_gray)

    softness = 3 * max(sky_noise(stack_gray), 1e-12)
    white = max(float(np.nanpercentile(stack_gray, 99.9)), softness)
    write_webp(stretch(stack, softness, white), output / "stack.webp", "[Q=92]")
    write_webp(stretch(single, softness, white), output / "best.webp", "[Q=92]")
    most = int(depth.max())
    relative = (depth.astype(np.float32) / max(most, 1) * 255).astype(np.uint8)
    write_webp(np.repeat(relative[:, :, None], 3, axis=2), output / "depth.webp", "[lossless]")
    subprocess.run(["vips", "thumbnail", str(output / "stack.webp"), str(output / "thumb.webp") + "[Q=85]", "320"], check=True, capture_output=True, timeout=60)

    return {
        **result,
        "frames": [{
            "id": frame["id"],
            "weight": frame["weight"],
            "noise": frame["noise"],
            "sharpness_pixels": frame["sharpness_pixels"],
            "gamma": frame["gamma"],
            "stars": frame["stars"],
        } for frame in frames],
        "best_id": best["id"],
        "max_coverage": most,
        "limiting_mag": limit,
        "best_limiting_mag": best_limit,
        "gain_mag": limit - best_limit if limit is not None and best_limit is not None else None,
        "stars_recovered": recovered_stars(stack_gray, request["stars"], grid),
        "best_stars_recovered": recovered_stars(single_gray, request["stars"], grid),
    }


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (540, 540))
    try:
        request_data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        print(json.dumps(build(request_data, Path(sys.argv[2]), Path(sys.argv[3]))))
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)[:200]}))
        sys.exit(1)
