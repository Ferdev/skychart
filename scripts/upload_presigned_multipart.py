#!/usr/bin/env python3
"""Upload a large local file using a scoped multipart plan from GitHub Actions."""

from __future__ import annotations

import argparse
import base64
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text())
    size = args.input.stat().st_size
    if size != int(plan["size"]):
        raise SystemExit(f"Input size {size} does not match multipart plan size {plan['size']}")
    state = json.loads(args.state.read_text()) if args.state.exists() else {"etags": {}}
    etags = state.setdefault("etags", {})
    part_size = int(plan["part_size"])

    with args.input.open("rb") as source:
        for part_number, url in enumerate(plan["urls"], start=1):
            key = str(part_number)
            if key in etags:
                continue
            offset = (part_number - 1) * part_size
            length = min(part_size, size - offset)
            source.seek(offset)
            payload = source.read(length)
            if len(payload) != length:
                raise SystemExit(f"Unable to read multipart part {part_number}")
            etag = upload_part(url, payload, part_number)
            etags[key] = etag
            write_json_atomic(args.state, state)
            print(f"Uploaded part {part_number}/{len(plan['urls'])} ({length:,} bytes)", flush=True)

    parts = {"Parts": [
        {"ETag": etags[str(part_number)], "PartNumber": part_number}
        for part_number in range(1, len(plan["urls"]) + 1)
    ]}
    write_json_atomic(args.output, parts)
    print("parts_base64=" + base64.b64encode(json.dumps(parts, separators=(",", ":")).encode()).decode())
    return 0


def upload_part(url: str, payload: bytes, part_number: int) -> str:
    error: Exception | None = None
    for attempt in range(1, 6):
        try:
            request = Request(url, data=payload, method="PUT", headers={"Content-Length": str(len(payload))})
            with urlopen(request, timeout=1_800) as response:
                etag = response.headers.get("ETag")
                if response.status != 200 or not etag:
                    raise RuntimeError(f"part {part_number} returned {response.status} without an ETag")
                return etag
        except Exception as caught:
            error = caught
            if attempt < 5:
                time.sleep(2**attempt)
    raise RuntimeError(f"Unable to upload part {part_number} after retries") from error


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


if __name__ == "__main__":
    raise SystemExit(main())
