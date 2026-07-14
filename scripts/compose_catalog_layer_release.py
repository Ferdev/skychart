#!/usr/bin/env python3
"""Compose one audited point-layer artifact into an immutable atlas release."""

from __future__ import annotations

import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-manifest", required=True)
    parser.add_argument("--layer-manifest", type=Path, required=True)
    parser.add_argument("--public-base-url", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compose(
        load_manifest(args.base_manifest),
        json.loads(args.layer_manifest.read_text()),
        args.public_base_url,
        args.version,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(f"Composed {args.version}: {len(result['layers'])} immutable layers")
    return 0


def compose(base: dict, addition: dict, public_base_url: str, version: str) -> dict:
    result = copy.deepcopy(base)
    new_layers = addition.get("layers", [])
    if len(new_layers) != 1 or not new_layers[0].get("id"):
        raise ValueError("Layer manifest must contain exactly one named layer")
    layer = copy.deepcopy(new_layers[0])
    layer_id = layer["id"]
    if any(existing.get("id") == layer_id for existing in result.get("layers", [])):
        raise ValueError(f"Base manifest already contains layer {layer_id!r}")
    container_name = Path(layer.get("container", "")).name
    if not container_name:
        raise ValueError("Added layer must name its immutable container")
    layer["container"] = f"{public_base_url.rstrip('/')}/{container_name}"
    source_counts = dict(result.get("source_counts", {}))
    for key, value in addition.get("source_counts", {}).items():
        if key in source_counts:
            raise ValueError(f"Source count {key!r} already exists in base manifest")
        if int(value) <= 0:
            raise ValueError(f"Source count {key!r} must be positive")
        source_counts[key] = int(value)
    sources = dict(result.get("catalog_sources", {}))
    sources[layer_id] = {
        "source": addition.get("source"),
        "selection": addition.get("selection"),
        "cosmology": addition.get("cosmology"),
        "deduplication": addition.get("deduplication"),
    }
    result.update({
        "version": version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_counts": source_counts,
        "catalog_sources": sources,
        "layers": [*result.get("layers", []), layer],
    })
    return result


def load_manifest(value: str) -> dict:
    if value.startswith("https://"):
        with urlopen(value, timeout=30) as response:
            return json.load(response)
    return json.loads(Path(value).read_text())


if __name__ == "__main__":
    raise SystemExit(main())
