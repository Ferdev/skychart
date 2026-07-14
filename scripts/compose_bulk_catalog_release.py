#!/usr/bin/env python3
"""Carry audited bulk layers into a newly built immutable catalog release."""

from __future__ import annotations

import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


BULK_LAYER_MINIMUMS = {
    "gaia_stars": 190_000_000,
    "desi_dr1": 14_000_000,
    "quaia_g20": 500_000,
}

CARRY_METADATA_KEYS = (
    "gaia_tier",
    "parallax_over_error_min",
    "desi_source",
    "desi_selection",
    "desi_cosmology",
    "catalog_sources",
    "source_counts",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-manifest", required=True, help="Newly built local manifest or HTTPS URL")
    parser.add_argument("--carry-forward-manifest", required=True, help="Audited bulk manifest path or HTTPS URL")
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    result = compose(
        load_manifest(args.base_manifest),
        load_manifest(args.carry_forward_manifest),
        args.version,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(
        f"Composed {args.version}: {len(result['layers'])} layers, "
        f"{mapped_source_count(result):,} mapped source objects"
    )
    return 0


def compose(base: dict, carry_forward: dict, version: str) -> dict:
    base_layers = unique_layers(base, "base")
    carry_layers = unique_layers(carry_forward, "carry-forward")
    carried = {}

    for layer_id, minimum in BULK_LAYER_MINIMUMS.items():
        layer = carry_layers.get(layer_id)
        if layer is None:
            raise ValueError(f"Carry-forward manifest is missing required bulk layer {layer_id!r}")
        count = layer_source_count(layer)
        if count < minimum:
            raise ValueError(
                f"Carry-forward layer {layer_id!r} has {count:,} sources; expected at least {minimum:,}"
            )
        container = layer.get("container")
        if not isinstance(container, str) or not container.startswith("https://") or not container.endswith(".smpk"):
            raise ValueError(f"Carry-forward layer {layer_id!r} must reference an immutable HTTPS SMPK container")
        carried[layer_id] = copy.deepcopy(layer)

    if "gaia_stars" not in base_layers:
        raise ValueError("Base manifest must contain a gaia_stars layer to replace")

    layers = []
    for layer in base.get("layers", []):
        layer_id = layer.get("id")
        if layer_id == "gaia_stars":
            layers.extend((carried["gaia_stars"], carried["desi_dr1"]))
        elif layer_id not in {"desi_dr1", "quaia_g20"}:
            layers.append(copy.deepcopy(layer))
    layers.append(carried["quaia_g20"])

    if len({layer["id"] for layer in layers}) != len(layers):
        raise ValueError("Composed manifest contains duplicate layer IDs")

    result = copy.deepcopy(base)
    result.update(
        {
            "version": version,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "layers": layers,
        }
    )
    for key in CARRY_METADATA_KEYS:
        if key in carry_forward:
            result[key] = copy.deepcopy(carry_forward[key])
    return result


def unique_layers(manifest: dict, label: str) -> dict[str, dict]:
    layers = manifest.get("layers")
    if not isinstance(layers, list):
        raise ValueError(f"{label.capitalize()} manifest has no layers array")
    result = {}
    for layer in layers:
        layer_id = layer.get("id") if isinstance(layer, dict) else None
        if not isinstance(layer_id, str) or not layer_id:
            raise ValueError(f"{label.capitalize()} manifest contains an unnamed layer")
        if layer_id in result:
            raise ValueError(f"{label.capitalize()} manifest contains duplicate layer {layer_id!r}")
        result[layer_id] = layer
    return result


def layer_source_count(layer: dict) -> int:
    counts = layer.get("source_counts")
    if not isinstance(counts, dict):
        return 0
    return sum(int(value) for value in counts.values())


def mapped_source_count(manifest: dict) -> int:
    return sum(layer_source_count(layer) for layer in manifest.get("layers", []))


def load_manifest(value: str) -> dict:
    if value.startswith("https://"):
        with urlopen(value, timeout=30) as response:
            return json.load(response)
    return json.loads(Path(value).read_text())


if __name__ == "__main__":
    raise SystemExit(main())
