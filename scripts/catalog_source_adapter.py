"""Bounded file readers for pinned source schemas; no archive paging or UI scraping."""
from contextlib import contextmanager
import csv
import gzip
import itertools
import math
import re
import xml.etree.ElementTree as ET


@contextmanager
def text_stream(path, compression):
    opener = gzip.open if compression == "gzip" else open
    with opener(path, "rt", encoding="utf-8", newline="") as stream:
        yield stream


def rows(path, part, fields):
    names = [field["name"] for field in fields]
    kind = part["format"]
    if kind == "fits":
        if part.get("compression"):
            raise ValueError("decompress FITS to bounded scratch disk before staging in batches")
        import fitsio
        import numpy as np
        with fitsio.FITS(path) as hdus:
            table = hdus[part.get("hdu", 1)]
            if table.get_colnames() != names:
                raise ValueError("FITS schema drift")
            for start in range(0, table.get_nrows(), 1000):
                for row in table[start:start+1000]:
                    yield [None if row[name] is None or np.ma.is_masked(row[name]) or
                           (np.isscalar(row[name]) and isinstance(row[name], (float, np.floating)) and not np.isfinite(row[name]))
                           else str(row[name]) for name in names]
        return
    with text_stream(path, part.get("compression")) as stream:
        if kind == "votable":
            # TABLEDATA streams only. Reject BINARY/BINARY2 rather than loading
            # an unbounded table or silently emitting zero rows.
            found, table_seen = [], False
            stack = []
            for event, element in ET.iterparse(stream, events=("start", "end")):
                tag = element.tag.rsplit("}", 1)[-1]
                if event == "start":
                    stack.append(element)
                    if tag in {"BINARY", "BINARY2", "FITS"}:
                        raise ValueError("only streaming VOTable TABLEDATA is supported")
                    if tag == "TABLE":
                        if table_seen:
                            raise ValueError("manifest must identify a single VOTable table")
                        table_seen = True
                else:
                    if tag == "FIELD":
                        found.append(element.attrib.get("name"))
                    if tag == "TR":
                        if found != names:
                            raise ValueError("VOTable schema drift")
                        yield [cell.text for cell in element]
                        stack[-2].remove(element)
                    stack.pop()
            if found != names or not table_seen:
                raise ValueError("VOTable schema drift or missing table")
            return
        if kind == "cds_fixed":
            for line in stream:
                if len(line.rstrip("\r\n")) < max(f["start"] + f["width"] for f in fields):
                    yield []  # Quarantine a malformed record with its line number.
                else:
                    yield [line[f["start"]:f["start"] + f["width"]].strip() for f in fields]
            return
        if kind not in {"csv", "ecsv", "delimited"}:
            raise ValueError("unsupported file format")
        if kind == "ecsv":
            stream = itertools.dropwhile(lambda line: line.startswith("#"), stream)
        reader = csv.reader(stream, delimiter=part.get("delimiter", ","), strict=True)
        if part.get("header", True) and next(reader, None) != names:
            raise ValueError("source header differs from pinned schema")
        yield from reader


def parse_row(values, fields, nulls):
    if len(values) != len(fields):
        raise ValueError("column_count")
    record = {}
    for value, field in zip(values, fields):
        kind = field["type"]
        if value is None or value in nulls:
            record[field["name"]] = None
        elif kind in {"text", "id"}:
            record[field["name"]] = value
        elif kind == "integer":
            if not re.fullmatch(r"[+-]?\d+", value.strip()):
                raise ValueError("invalid_integer:" + field["name"])
            # All integer scientific fields remain lossless in JSON clients.
            record[field["name"]] = str(int(value))
        elif kind == "float":
            number = float(value)
            if not math.isfinite(number):
                raise ValueError("nonfinite:" + field["name"])
            record[field["name"]] = number
        else:
            raise ValueError("unsupported field type")
    return record
