#!/usr/bin/env python3
"""Resumably download and column-prune the official Gaia DR3 source archive.

Each verified ECSV gzip chunk is converted to a compact Parquet file before the
compressed source is removed. Existing verified Parquet outputs are skipped, so
the command is safe to stop and restart.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import urlopen

ARCHIVE_URL = "https://cdn.gea.esac.esa.int/Gaia/gdr3/gaia_source"
MANIFEST_NAME = "_MD5SUM.txt"
MANIFEST_PATTERN = re.compile(r"^([0-9a-f]{32})\s+(GaiaSource_[0-9]+-[0-9]+\.csv\.gz)$")
COLUMNS = (
    ("source_id", "UBIGINT"),
    ("ra", "DOUBLE"),
    ("dec", "DOUBLE"),
    ("parallax", "REAL"),
    ("parallax_over_error", "REAL"),
    ("phot_g_mean_mag", "REAL"),
    ("bp_rp", "REAL"),
    ("pmra", "REAL"),
    ("pmdec", "REAL"),
)


@dataclass(frozen=True)
class ArchiveEntry:
    md5: str
    filename: str

    @property
    def stem(self) -> str:
        return self.filename.removesuffix(".csv.gz")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("manifest", "ingest", "status"))
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(os.environ.get("GAIA_ROOT", "data/gaia-work")),
    )
    parser.add_argument("--max-files", type=int, default=0, help="Stop after this many new files; zero means all")
    parser.add_argument("--keep-downloads", action="store_true")
    parser.add_argument("--shard-count", type=int, default=1, help="Number of independent workers sharing this root")
    parser.add_argument("--shard-index", type=int, default=0, help="Zero-based worker index")
    args = parser.parse_args()

    args.root.mkdir(parents=True, exist_ok=True)
    manifest_path = refresh_manifest(args.root) if args.command == "manifest" else ensure_manifest(args.root)
    entries = parse_manifest(manifest_path.read_text())
    if args.command == "manifest":
        print(json.dumps({"manifest": str(manifest_path), "files": len(entries)}, indent=2))
        return 0
    if args.command == "status":
        print(json.dumps(build_status(args.root, entries), indent=2))
        return 0
    if args.shard_count < 1 or not 0 <= args.shard_index < args.shard_count:
        parser.error("--shard-index must be between zero and --shard-count minus one")
    return ingest(args.root, entries, args.max_files, args.keep_downloads, args.shard_index, args.shard_count)


def ensure_manifest(root: Path) -> Path:
    path = root / MANIFEST_NAME
    return path if path.exists() else refresh_manifest(root)


def refresh_manifest(root: Path) -> Path:
    destination = root / MANIFEST_NAME
    temporary = destination.with_suffix(".txt.part")
    with urlopen(f"{ARCHIVE_URL}/{MANIFEST_NAME}", timeout=60) as response:
        temporary.write_bytes(response.read())
    entries = parse_manifest(temporary.read_text())
    if len(entries) < 3_000:
        raise SystemExit(f"Official manifest is unexpectedly short: {len(entries)} entries")
    temporary.replace(destination)
    return destination


def parse_manifest(contents: str) -> list[ArchiveEntry]:
    entries = []
    for line in contents.splitlines():
        match = MANIFEST_PATTERN.fullmatch(line.strip())
        if match:
            entries.append(ArchiveEntry(match.group(1), match.group(2)))
    return entries


def ingest(root: Path, entries: list[ArchiveEntry], max_files: int, keep_downloads: bool, shard_index: int = 0, shard_count: int = 1) -> int:
    duckdb = require_duckdb()
    downloads = root / "downloads"
    parquet = root / "parquet"
    logs = root / "logs"
    for directory in (downloads, parquet, logs):
        directory.mkdir(parents=True, exist_ok=True)

    completed = 0
    connection = duckdb.connect(str(root / f"ingest-{shard_index:02d}-of-{shard_count:02d}.duckdb"))
    connection.execute("SET preserve_insertion_order=false")
    connection.execute("SET threads=4")
    connection.execute("SET memory_limit='8GB'")
    work_entries = [(index, entry) for index, entry in enumerate(entries, start=1) if (index - 1) % shard_count == shard_index]
    for index, entry in work_entries:
        output = parquet / f"{entry.stem}.parquet"
        if parquet_is_complete(connection, output):
            continue
        if max_files and completed >= max_files:
            break
        compressed = downloads / entry.filename
        print(f"[worker {shard_index + 1}/{shard_count} · {index}/{len(entries)}] downloading {entry.filename}", flush=True)
        download(entry, compressed)
        print(f"[{index}/{len(entries)}] verifying MD5", flush=True)
        verify_md5(compressed, entry.md5)
        print(f"[{index}/{len(entries)}] extracting nine columns", flush=True)
        row_count = convert_to_parquet(connection, compressed, output)
        write_receipt(logs, entry, output, row_count)
        if not keep_downloads:
            compressed.unlink(missing_ok=True)
        completed += 1
        print(f"[{index}/{len(entries)}] complete: {row_count:,} rows", flush=True)
    print(json.dumps(build_status(root, entries), indent=2), flush=True)
    return 0


def require_duckdb():
    try:
        import duckdb
        return duckdb
    except ImportError as error:
        raise SystemExit(
            "DuckDB is required. Create a virtual environment and install "
            "scripts/gaia_bulk_requirements.txt."
        ) from error


def download(entry: ArchiveEntry, destination: Path) -> None:
    partial = destination.with_suffix(destination.suffix + ".part")
    command = [
        "curl", "--fail", "--location", "--no-progress-meter", "--continue-at", "-", "--retry", "12",
        "--retry-all-errors", "--connect-timeout", "30", "--speed-time", "60",
        "--speed-limit", "1024", "--output", str(partial), f"{ARCHIVE_URL}/{entry.filename}",
    ]
    subprocess.run(command, check=True)
    partial.replace(destination)


def verify_md5(path: Path, expected: str) -> None:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        path.unlink(missing_ok=True)
        raise RuntimeError(f"MD5 mismatch for {path.name}; removed corrupt download")


def convert_to_parquet(connection, source: Path, destination: Path) -> int:
    temporary = destination.with_suffix(".parquet.part")
    escaped_source = str(source).replace("'", "''")
    escaped_output = str(temporary).replace("'", "''")
    selections = ", ".join(f"TRY_CAST({name} AS {kind}) AS {name}" for name, kind in COLUMNS)
    connection.execute(
        f"""
        COPY (
          SELECT {selections}
          FROM read_csv('{escaped_source}', header=true, comment='#', all_varchar=true,
                        compression='gzip', strict_mode=false)
          WHERE TRY_CAST(source_id AS UBIGINT) IS NOT NULL
        ) TO '{escaped_output}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 262144)
        """
    )
    row_count = int(connection.execute(f"SELECT count(*) FROM read_parquet('{escaped_output}')").fetchone()[0])
    if row_count < 100_000:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Unexpectedly short Gaia chunk {source.name}: {row_count} rows")
    temporary.replace(destination)
    return row_count


def parquet_is_complete(connection, path: Path) -> bool:
    if not path.exists():
        return False
    escaped = str(path).replace("'", "''")
    try:
        description = connection.execute(f"DESCRIBE SELECT * FROM read_parquet('{escaped}')").fetchall()
        return [row[0] for row in description] == [name for name, _ in COLUMNS]
    except Exception:
        path.unlink(missing_ok=True)
        return False


def write_receipt(logs: Path, entry: ArchiveEntry, output: Path, row_count: int) -> None:
    receipt = {
        **asdict(entry),
        "parquet": output.name,
        "rows": row_count,
        "completed_at": datetime.now(UTC).isoformat(),
    }
    destination = logs / f"{entry.stem}.json"
    temporary = destination.with_suffix(".json.part")
    temporary.write_text(json.dumps(receipt, indent=2) + "\n")
    temporary.replace(destination)


def build_status(root: Path, entries: list[ArchiveEntry]) -> dict[str, object]:
    parquet = root / "parquet"
    completed = sum((parquet / f"{entry.stem}.parquet").exists() for entry in entries)
    downloaded_bytes = sum(path.stat().st_size for path in (root / "downloads").glob("*.part")) if (root / "downloads").exists() else 0
    parquet_bytes = sum(path.stat().st_size for path in parquet.glob("*.parquet")) if parquet.exists() else 0
    return {
        "root": str(root),
        "official_files": len(entries),
        "completed_files": completed,
        "remaining_files": len(entries) - completed,
        "partial_download_bytes": downloaded_bytes,
        "parquet_bytes": parquet_bytes,
    }


if __name__ == "__main__":
    raise SystemExit(main())
