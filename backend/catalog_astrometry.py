"""Versioned catalog geometry. Pure functions; no network or ephemeris loading."""
import json
import math
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parents[1] /
                       "backend_phoenix/priv/catalog_coordinate_contract.json").read_text())
FRAME = CONTRACT["frame"]
OBLIQUITY = math.radians(CONTRACT["obliquity_deg"])
ROTATION = ((1.0, 0.0, 0.0), (0.0, math.cos(OBLIQUITY), math.sin(OBLIQUITY)),
            (0.0, -math.sin(OBLIQUITY), math.cos(OBLIQUITY)))


def propagate_direction(ra_deg, dec_deg, pmra, pmdec, source_epoch, display_epoch):
    """pmra is mu_alpha*cos(delta), in mas/yr. Unknown motion stays unknown."""
    if pmra is None or pmdec is None:
        return ra_deg, dec_deg, source_epoch
    if not all(math.isfinite(v) for v in (ra_deg, dec_deg, pmra, pmdec, source_epoch, display_epoch)):
        raise ValueError("nonfinite astrometry")
    r, d = math.radians(ra_deg), math.radians(dec_deg)
    scale = math.radians((display_epoch - source_epoch) / 3_600_000)
    x = math.cos(d) * math.cos(r) + scale * (-pmra * math.sin(r) - pmdec * math.sin(d) * math.cos(r))
    y = math.cos(d) * math.sin(r) + scale * (pmra * math.cos(r) - pmdec * math.sin(d) * math.sin(r))
    z = math.sin(d) + scale * pmdec * math.cos(d)
    return math.degrees(math.atan2(y, x)) % 360, math.degrees(math.atan2(z, math.hypot(x, y))), display_epoch


def physical_parallax_distance(parallax_mas, parallax_error_mas, minimum_snr=5):
    """An explicit placement estimator, never a source-record acceptance filter."""
    if parallax_mas is None or parallax_error_mas is None:
        return None
    if not all(math.isfinite(v) for v in (parallax_mas, parallax_error_mas, minimum_snr)):
        return None
    if minimum_snr <= 0:
        raise ValueError("minimum SNR must be positive")
    if parallax_mas <= 0 or parallax_error_mas <= 0 or parallax_mas / parallax_error_mas < minimum_snr:
        return None
    return {"distance_pc": 1000 / parallax_mas, "model": "parallax_estimate",
            "parallax_mas": parallax_mas, "parallax_error_mas": parallax_error_mas,
            "minimum_snr": minimum_snr}
