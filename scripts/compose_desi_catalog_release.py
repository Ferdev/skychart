#!/usr/bin/env python3
"""Add or replace the DESI DR1 layer in an immutable tile manifest."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-manifest", required=True)
    parser.add_argument("--desi-manifest", type=Path, required=True)
    parser.add_argument("--public-base-url", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    base = load_manifest(args.base_manifest)
    desi = json.loads(args.desi_manifest.read_text())
    desi_layers = [layer for layer in desi.get("layers", []) if layer.get("id") == "desi_dr1"]
    if len(desi_layers) != 1:
        raise SystemExit("DESI manifest must contain exactly one desi_dr1 layer")
    counts = desi.get("source_counts", {})
    if int(counts.get("desi_dr1_galaxies", 0)) <= 0 or int(counts.get("desi_dr1_quasars", 0)) <= 0:
        raise SystemExit("DESI manifest must contain positive galaxy and quasar counts")

    public_base_url = args.public_base_url.rstrip("/")
    desi_layer = desi_layers[0]
    desi_layer["container"] = f"{public_base_url}/desi_dr1.smpk"
    layers = [layer for layer in base.get("layers", []) if layer.get("id") != "desi_dr1"]
    gaia_index = next((index for index, layer in enumerate(layers) if layer.get("id") == "gaia_stars"), -1)
    layers.insert(gaia_index + 1 if gaia_index >= 0 else 0, desi_layer)
    source_counts = dict(base.get("source_counts", {}))
    source_counts.update(counts)
    base.update({
        "version": args.version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_counts": source_counts,
        "desi_source": desi.get("source"),
        "desi_selection": desi.get("selection"),
        "desi_cosmology": desi.get("cosmology"),
        "layers": layers,
    })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(base, indent=2, sort_keys=True) + "\n")
    print(
        f"Composed {args.version}: {len(layers)} layers, "
        f"{counts['desi_dr1_galaxies']:,} DESI galaxies, "
        f"{counts['desi_dr1_quasars']:,} DESI quasars"
    )
    return 0


def load_manifest(value: str) -> dict:
    if value.startswith("https://"):
        with urlopen(value, timeout=30) as response:
            return json.load(response)
    return json.loads(Path(value).read_text())


if __name__ == "__main__":
    raise SystemExit(main())
