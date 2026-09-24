#!/usr/bin/env python3
"""Sequentially measure complete IRSA bar-delimited bzip2 table releases.

Every source part is size/MD5 verified, decoded using the pinned provider
schema, written to an all-field candidate Parquet, and compared field-for-field
against a second source pass. Source, candidate and projection temporaries are
recycled only after the durable receipt is committed.
"""
import argparse
import bz2
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import time
from urllib.request import Request, urlopen

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as csv
import pyarrow.parquet as pq

from inventory_irsa_bulk_release import parse_md5, parse_sizes
from measure_gaia_full_partitions import guard, save, sha


FORMAT = "irsa-bzip-bar-delimited-zstd3-rg8192-v1"


def field_type(spec):
    upper = spec.upper()
    if any(token in upper for token in ("CHAR(", "VARCHAR", " DATE")):
        return pa.string()
    decimal = re.search(r"(?:DECIMAL|NUMBER)\((\d+),(\d+)\)", upper)
    if decimal:
        precision, scale = map(int, decimal.groups())
        return pa.decimal128(precision, scale)
    if re.search(r"\b(SERIAL8|INT8)\b", upper):
        return pa.int64()
    if re.search(r"\bSMALLINT\b", upper):
        return pa.int16()
    if re.search(r"\bINTEGER\b", upper):
        return pa.int32()
    if re.search(r"\b(FLOAT|REAL|SMALLFLOAT|DOUBLE PRECISION)\b", upper):
        return pa.float64()
    raise ValueError("unsupported provider schema type: " + spec)


def schema_from(data):
    fields = []
    for line in data.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name, spec = stripped.split(None, 1)
        fields.append(pa.field(name, field_type(" " + spec)))
    if not fields or len({field.name for field in fields}) != len(fields):
        raise ValueError("invalid provider schema")
    return pa.schema(fields, metadata={b"format": FORMAT.encode(), b"provider_schema": data})


class CountedBzipReader:
    def __init__(self, path):
        self.stream = bz2.open(path, "rb")
        self.bytes = 0
        self.digest = hashlib.sha256()

    def read(self, size=-1):
        data = self.stream.read(size)
        self.bytes += len(data)
        self.digest.update(data)
        return data

    def readable(self):
        return True

    def seekable(self):
        return False

    def writable(self):
        return False

    @property
    def closed(self):
        return self.stream.closed

    def close(self):
        self.stream.close()


class SourceReader:
    def __init__(self, path, schema, trailing_delimiter=False):
        self.counted = CountedBzipReader(path)
        self.arrow = pa.PythonFile(self.counted, mode="r")
        self.schema = schema
        self.trailing_delimiter = trailing_delimiter
        input_schema = (schema.append(pa.field("__empty_record_terminator", pa.string()))
                        if trailing_delimiter else schema)
        self.reader = csv.open_csv(
            self.arrow,
            read_options=csv.ReadOptions(column_names=input_schema.names, use_threads=False, block_size=8 << 20),
            parse_options=csv.ParseOptions(delimiter="|", quote_char=False),
            convert_options=csv.ConvertOptions(
                column_types={field.name: field.type for field in input_schema},
                null_values=["\\N", ""], strings_can_be_null=True,
            ),
        )

    def __iter__(self):
        for batch in self.reader:
            if self.trailing_delimiter:
                tail = batch.column(batch.num_columns - 1)
                nonempty = pc.any(pc.not_equal(pc.fill_null(tail, ""), "")).as_py()
                if nonempty:
                    raise ValueError("record terminator column contains provider data")
                batch = batch.select(self.schema.names)
            yield batch

    def close(self):
        self.arrow.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def measure(source, detail, projection, schema, projection_columns, root, floor, trailing_delimiter=False):
    started = time.monotonic()
    projected_schema = pa.schema(
        [schema.field(name) for name in projection_columns],
        metadata={b"purpose": b"candidate build projection, not a serving artifact"},
    )
    rows = 0
    with SourceReader(source, schema, trailing_delimiter) as input_rows, \
            pq.ParquetWriter(detail, schema, compression="zstd", compression_level=3) as writer, \
            pq.ParquetWriter(projection, projected_schema, compression="zstd", compression_level=3) as projected:
        for batch in input_rows:
            table = pa.Table.from_batches([batch]).replace_schema_metadata(schema.metadata)
            writer.write_table(table, row_group_size=8192)
            projected.write_table(
                table.select(projection_columns).replace_schema_metadata(projected_schema.metadata),
                row_group_size=8192,
            )
            rows += len(table)
            guard(root, floor)
        uncompressed_bytes = input_rows.counted.bytes
        uncompressed_sha256 = input_rows.counted.digest.hexdigest()
    stored = pq.ParquetFile(detail)
    build = pq.ParquetFile(projection)
    group = verified = 0
    with SourceReader(source, schema, trailing_delimiter) as input_rows:
        for batch in input_rows:
            table = pa.Table.from_batches([batch]).replace_schema_metadata(schema.metadata)
            for offset in range(0, len(table), 8192):
                expected = table.slice(offset, 8192)
                if not expected.equals(stored.read_row_group(group)):
                    raise ValueError("candidate detail lost provider field values")
                small = expected.select(projection_columns).replace_schema_metadata(projected_schema.metadata)
                if not small.equals(build.read_row_group(group)):
                    raise ValueError("build projection lost provider field values")
                group += 1
                verified += len(expected)
            guard(root, floor)
        if (input_rows.counted.bytes != uncompressed_bytes or
                input_rows.counted.digest.hexdigest() != uncompressed_sha256):
            raise ValueError("source decompression changed between passes")
    if verified != rows or stored.metadata.num_rows != rows or build.metadata.num_rows != rows:
        raise ValueError("decoded row accounting mismatch")
    return {
        "format": FORMAT, "rows": rows, "columns": len(schema),
        "source_bytes": source.stat().st_size, "source_sha256": sha(source),
        "uncompressed_bytes": uncompressed_bytes, "uncompressed_sha256": uncompressed_sha256,
        "detail_bytes": detail.stat().st_size,
        "detail_allocated_bytes": detail.stat().st_blocks * 512, "detail_sha256": sha(detail),
        "build_projection": {
            "columns": projection_columns, "bytes": projection.stat().st_size,
            "allocated_bytes": projection.stat().st_blocks * 512, "sha256": sha(projection),
        },
        "all_fields_verified": True, "full_bzip_crc_verified": True,
        "empty_trailing_delimiter_verified": trailing_delimiter,
        "seconds": time.monotonic() - started,
        "peak_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "full_serving_bytes": None,
    }


def _hash_source(path, root, floor):
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while block := stream.read(1 << 20):
            size += len(block)
            md5.update(block)
            sha256.update(block)
            guard(root, floor)
    return size, md5, sha256


def download(url, target, expected_bytes, expected_md5, root, floor):
    """Download or resume one manifest-pinned source without trusting Range support."""
    initial_bytes = target.stat().st_size if target.exists() else 0
    if initial_bytes > expected_bytes:
        raise ValueError("interrupted source exceeds pinned size")
    if initial_bytes:
        size, md5, sha256 = _hash_source(target, root, floor)
    else:
        size, md5, sha256 = 0, hashlib.md5(), hashlib.sha256()
    if size == expected_bytes:
        if md5.hexdigest() != expected_md5:
            raise ValueError("complete interrupted source failed provider MD5")
        return {
            "sha256": sha256.hexdigest(), "resumed_bytes": size,
            "downloaded_bytes": 0, "server_restarted_download": False,
        }

    headers = {"User-Agent": "SkyChart storage investigation/1271"}
    if size:
        headers["Range"] = f"bytes={size}-"
    request = Request(url, headers=headers)
    with urlopen(request, timeout=180) as response:
        status = getattr(response, "status", None)
        if status is None:
            status = response.getcode()
        restarted = False
        resumed_bytes = size
        mode = "ab" if size else "wb"
        if size and status == 206:
            content_range = response.headers.get("Content-Range", "")
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", content_range)
            if (not match or int(match.group(1)) != size or
                    int(match.group(3)) != expected_bytes):
                raise ValueError("provider returned an invalid resume range")
        elif size and status == 200:
            # Some archives ignore Range. A pinned full restart is still safe.
            size, md5, sha256 = 0, hashlib.md5(), hashlib.sha256()
            resumed_bytes = 0
            restarted = True
            mode = "wb"
        elif status not in (200, 206):
            raise ValueError(f"provider returned unexpected HTTP status {status}")
        elif status == 206:
            content_range = response.headers.get("Content-Range", "")
            if not re.fullmatch(rf"bytes 0-\d+/{expected_bytes}", content_range):
                raise ValueError("provider returned an invalid initial range")

        with target.open(mode) as output:
            downloaded = 0
            while block := response.read(1 << 20):
                size += len(block)
                downloaded += len(block)
                if size > expected_bytes:
                    raise ValueError("provider source exceeds pinned size")
                output.write(block)
                md5.update(block)
                sha256.update(block)
                guard(root, floor)
                if size % (256 << 20) == 0:
                    output.flush()
                    os.fdatasync(output.fileno())
                    if hasattr(os, "posix_fadvise"):
                        os.posix_fadvise(output.fileno(), 0, size, os.POSIX_FADV_DONTNEED)
            output.flush()
            os.fsync(output.fileno())
            if hasattr(os, "posix_fadvise"):
                os.posix_fadvise(output.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
    if size != expected_bytes or md5.hexdigest() != expected_md5:
        raise ValueError("truncated or changed provider source")
    return {
        "sha256": sha256.hexdigest(), "resumed_bytes": resumed_bytes,
        "downloaded_bytes": downloaded, "server_restarted_download": restarted,
    }


def progress(root, receipts, expected_parts, expected_rows):
    rows = [json.loads(path.read_text()) for path in sorted(receipts.glob("*.json"))]
    total_rows = sum(row["rows"] for row in rows)
    if len(rows) == expected_parts and total_rows != expected_rows:
        raise ValueError("full provider row count did not reconcile")
    result = {
        "status": "FULL_CANDIDATE_COMPONENT_MEASURED" if len(rows) == expected_parts else "INCOMPLETE",
        "files": len(rows), "expected_files": expected_parts,
        "rows": total_rows, "expected_rows": expected_rows,
        "source_bytes": sum(row["source_bytes"] for row in rows),
        "uncompressed_bytes": sum(row["uncompressed_bytes"] for row in rows),
        "candidate_detail_bytes": sum(row["detail_bytes"] for row in rows),
        "candidate_projection_bytes": sum(row["build_projection"]["bytes"] for row in rows),
        "full_serving_bytes": None,
    }
    save(root / "progress.json", result)
    return result


def main(args):
    args.root.mkdir(parents=True, exist_ok=True)
    lock = (args.root / ".lock").open("w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    marker = args.root / "OWNER"
    owner = f"SkyChart isolated {args.catalog_id} measurement 1271\n"
    if marker.exists() and marker.read_text() != owner:
        raise ValueError("unowned output root")
    if not marker.exists():
        if any(path.name != ".lock" for path in args.root.iterdir()):
            raise ValueError("refuse nonempty unowned output root")
        marker.write_text(owner)
    inventory = json.loads((args.inventory_root / "inventory.receipt.json").read_text())
    if inventory["catalog_id"] != args.catalog_id or inventory["parts"] != args.expected_parts:
        raise ValueError("provider inventory does not match requested release")
    metadata = inventory["provider_metadata_files"]
    md5s = parse_md5((args.inventory_root / metadata["md5"]["name"]).read_bytes())
    sizes = parse_sizes((args.inventory_root / metadata["sizes"]["name"]).read_bytes())
    schema_data = (args.inventory_root / metadata["schema"]["name"]).read_bytes()
    schema = schema_from(schema_data)
    if set(md5s) != set(sizes) or len(md5s) != args.expected_parts:
        raise ValueError("provider manifests changed")
    projection_columns = args.projection_columns.split(",")
    if not projection_columns or not set(projection_columns).issubset(schema.names):
        raise ValueError("projection references an absent provider field")
    pin = {
        "format": FORMAT, "catalog_id": args.catalog_id, "base_url": args.base_url,
        "inventory_receipt_sha256": sha(args.inventory_root / "inventory.receipt.json"),
        "schema_sha256": hashlib.sha256(schema_data).hexdigest(),
        "projection_columns": projection_columns, "expected_parts": args.expected_parts,
        "expected_rows": args.expected_rows,
        "trailing_delimiter": args.trailing_delimiter,
    }
    if (args.root / "manifest.json").exists() and json.loads((args.root / "manifest.json").read_text()) != pin:
        completed = list((args.root / "receipts").glob("*.json")) if (args.root / "receipts").exists() else []
        if completed:
            raise ValueError("pinned measurement contract changed after a completed partition")
    save(args.root / "manifest.json", pin)
    receipts = args.root / "receipts"
    receipts.mkdir(exist_ok=True)
    added = 0
    floor = args.free_floor_gib * (1 << 30)
    for index, name in enumerate(sorted(md5s)):
        receipt = receipts / f"{index:04d}.json"
        if receipt.exists():
            prior = json.loads(receipt.read_text())
            if (prior["source_file"] != name or prior["provider_md5"] != md5s[name] or
                    prior["format"] != FORMAT or not prior["all_fields_verified"]):
                raise ValueError("completed partition receipt changed")
            continue
        if args.max_files and added >= args.max_files:
            break
        if Path(name).name != name or not name.endswith(".bz2"):
            raise ValueError("unsafe provider filename")
        guard(args.root, floor)
        source = args.root / "source.tmp.bz2"
        detail = args.root / "detail.tmp.parquet"
        projection = args.root / "projection.tmp.parquet"
        started = time.time()
        save(args.root / "progress.json", {"status": "ACQUIRING", "index": index, "source_file": name})
        existing_bytes = source.stat().st_size if source.exists() else 0
        if existing_bytes == sizes[name]:
            transfer_status = "VERIFYING_REUSED_SOURCE"
        elif existing_bytes:
            transfer_status = "RESUMING_SOURCE"
        else:
            transfer_status = "ACQUIRING"
        save(args.root / "progress.json", {"status": transfer_status, "index": index,
                                             "source_file": name, "existing_bytes": existing_bytes})
        transfer = download(args.base_url.rstrip("/") + "/" + name, source,
                            sizes[name], md5s[name], args.root, floor)
        local_sha256 = transfer["sha256"]
        save(args.root / "progress.json", {"status": "MEASURING", "index": index, "source_file": name})
        for path in (detail, projection):
            if path.exists():
                path.unlink()
        result = measure(source, detail, projection, schema, projection_columns, args.root, floor, args.trailing_delimiter)
        if result["source_sha256"] != local_sha256:
            raise ValueError("download and stored source hashes disagree")
        result.update({
            "source_file": name, "source_url": args.base_url.rstrip("/") + "/" + name,
            "provider_md5": md5s[name], "provider_manifest_bytes": sizes[name],
            "wall_seconds_including_download": time.time() - started,
            "temporary_source_recycled_after_receipt": True,
            "temporary_detail_recycled_after_receipt": True,
            "temporary_projection_recycled_after_receipt": True,
            "source_reused_after_verified_interruption": transfer["resumed_bytes"] > 0,
            "source_resumed_bytes": transfer["resumed_bytes"],
            "source_downloaded_bytes_this_invocation": transfer["downloaded_bytes"],
            "source_server_restarted_download": transfer["server_restarted_download"],
        })
        save(receipt, result)
        for path in (source, detail, projection):
            path.unlink()
        added += 1
        print(json.dumps({"source_file": name, "rows": result["rows"],
                          "detail_bytes": result["detail_bytes"],
                          "wall_seconds": result["wall_seconds_including_download"]}), flush=True)
        progress(args.root, receipts, args.expected_parts, args.expected_rows)
    print(json.dumps(progress(args.root, receipts, args.expected_parts, args.expected_rows)), flush=True)


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--inventory-root", type=Path, required=True)
    parser.add_argument("--catalog-id", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--expected-parts", type=int, required=True)
    parser.add_argument("--expected-rows", type=int, required=True)
    parser.add_argument("--projection-columns", required=True)
    parser.add_argument("--free-floor-gib", type=int, default=60)
    parser.add_argument("--max-files", type=int, default=0)
    parser.add_argument("--trailing-delimiter", action="store_true")
    main(parser.parse_args())


if __name__ == "__main__":
    cli()
