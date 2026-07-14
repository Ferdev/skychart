#!/usr/bin/env python3
"""Replace only the Gaia layer in an immutable catalog-tile manifest."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-manifest", required=True, help="Existing local path or HTTPS manifest URL")
    parser.add_argument("--gaia-manifest", type=Path, required=True)
    parser.add_argument("--public-base-url", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    base = load_manifest(args.base_manifest)
    gaia = json.loads(args.gaia_manifest.read_text())
    gaia_layers = [layer for layer in gaia.get("layers", []) if layer.get("id") == "gaia_stars"]
    if len(gaia_layers) != 1:
        raise SystemExit("Bulk manifest must contain exactly one gaia_stars layer")
    if int(gaia.get("source_counts", {}).get("gaia_dr3_bulk", 0)) <= 0:
        raise SystemExit("Bulk manifest has no positive gaia_dr3_bulk source count")

    public_base_url = args.public_base_url.rstrip("/")
    gaia_layer = gaia_layers[0]
    gaia_layer["container"] = f"{public_base_url}/gaia_stars.smpk"
    replacement_count = 0
    layers = []
    for layer in base.get("layers", []):
        if layer.get("id") == "gaia_stars":
            layers.append(gaia_layer)
            replacement_count += 1
        else:
            layers.append(layer)
    if replacement_count != 1:
        raise SystemExit("Base manifest must contain exactly one gaia_stars layer")

    base.update({
        "version": args.version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "gaia_tier": gaia.get("gaia_tier"),
        "parallax_over_error_min": gaia.get("parallax_over_error_min"),
        "source_counts": gaia.get("source_counts"),
        "layers": layers,
    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(base, indent=2, sort_keys=True) + "\n")
    print(
        f"Composed {args.version}: {len(layers)} layers, "
        f"{gaia['source_counts']['gaia_dr3_bulk']:,} Gaia T2 sources"
    )
    return 0


def load_manifest(value: str) -> dict:
    if value.startswith("https://"):
        with urlopen(value, timeout=30) as response:
            return json.load(response)
    return json.loads(Path(value).read_text())


if __name__ == "__main__":
    raise SystemExit(main())
