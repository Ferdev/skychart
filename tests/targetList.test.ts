import assert from "node:assert/strict";
import { test } from "node:test";
import { matchRequestRow, parsePosition, parseTargetList, targetListCsv, targetMarkers, type TargetMatchRow } from "../src/destination/targetList.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} is not ${b}`);

test("a list of names, positions, comments, and blank lines", () => {
  const { rows } = parseTargetList("# my list\nM 31\n\nNGC 7000\r\n83.82 -5.39\n05:35:17.3 -05:23:28\n05h35m17.3s +05d23m28s\n05 35 17.3 -05 23 28\n");
  assert.deepEqual(rows.map((row) => row.line), [2, 4, 5, 6, 7, 8]);
  assert.equal(rows[0]!.name, "M 31");
  assert.equal(rows[1]!.name, "NGC 7000");
  assert.deepEqual([rows[2]!.ra_deg, rows[2]!.dec_deg], [83.82, -5.39]);
  near(rows[3]!.ra_deg!, 83.8221);
  near(rows[3]!.dec_deg!, -5.3911);
  near(rows[4]!.dec_deg!, 5.3911);
  near(rows[5]!.ra_deg!, 83.8221);
});

test("a position out of range is a name, so that it comes back unmatched", () => {
  assert.equal(parsePosition("400 10"), null);
  assert.equal(parsePosition("10 95"), null);
  assert.equal(parseTargetList("400 10").rows[0]!.name, "400 10");
});

test("a two-word object name is not a position", () => {
  assert.equal(parseTargetList("Orion Nebula").rows[0]!.name, "Orion Nebula");
  assert.equal(parseTargetList("M 31").rows[0]!.name, "M 31");
});

test("a CSV file with a header uses its columns", () => {
  const { rows } = parseTargetList('id,mag,ra,dec\n"M 31, Andromeda",3.4,,\n,,10.68,41.27\n;\n');
  assert.equal(rows[0]!.name, "M 31, Andromeda");
  assert.deepEqual([rows[1]!.ra_deg, rows[1]!.dec_deg], [10.68, 41.27]);
  assert.equal(rows.length, 2);
});

test("a byte order mark and tab separators are accepted", () => {
  const { rows } = parseTargetList("﻿name\tnote\nM 42\tOrion\n");
  assert.deepEqual(rows.map((row) => row.name), ["M 42"]);
});

test("a request row has a name or a position", () => {
  assert.deepEqual(matchRequestRow({ line: 1, input: "M 42", name: "M 42" }), { name: "M 42" });
  assert.deepEqual(matchRequestRow({ line: 1, input: "1 2", ra_deg: 1, dec_deg: 2 }), { ra_deg: 1, dec_deg: 2 });
});

const matched: TargetMatchRow = {
  input: "M 42", status: "matched", separation_arcsec: 12.34567, duplicate_of: 0,
  object: {
    key: "m42", name: "M42, Orion", object_type: "nebula", catalog_group: "messier_deep_sky",
    source: { label: "AstroPixels Messier Catalog", url: "https://astropixels.com/" },
    astrometry: { ra_deg: 83.82, dec_deg: -5.39 }, position: { x_au: 1, y_au: 2 },
  },
};

test("the CSV export keeps the source of a match", () => {
  const [header, row] = targetListCsv([matched]).split("\r\n");
  assert.ok(header!.includes("source,source_url"));
  assert.equal(row, '1,M 42,matched,m42,"M42, Orion",nebula,83.82,-5.39,12.346,messier_deep_sky,AstroPixels Messier Catalog,https://astropixels.com/,1');
});

test("a cell of the list cannot run as a spreadsheet formula, and a number keeps its sign", () => {
  const csv = targetListCsv([{ input: '=HYPERLINK("http://x")', status: "unmatched" }, matched]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(csv.includes(",-5.39,"));
});

test("a marker is for each matched object, one time", () => {
  const markers = targetMarkers([matched, matched, { input: "x", status: "unmatched" }, { input: "y", status: "ambiguous", candidates: [] }]);
  assert.deepEqual(markers.map((marker) => marker.key), ["m42"]);
  assert.equal(markers[0]!.xAu, 1);
});
