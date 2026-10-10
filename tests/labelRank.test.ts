import assert from "node:assert/strict";
import {
  isCatalogDesignation,
  labelClass,
  labelClassRank,
  labelRank,
  labelRectsOverlap,
  placeLabels,
  rankLabels,
  type LabelPoint,
  type LabelRect,
} from "../src/labels/labelRank.ts";

// Catalog designations of the atlas catalogs.
for (const name of [
  "HIP 10234", "HD 28185", "Gaia DR3 6443636359270855552", "TYC 1234-567-1", "2MASS J05352184-0546085",
  "3eRASS J123456.7-012345", "1eRASS J010203.4+050607", "SDSS J094533.99+100950.1", "UCAC4 590-002111", "G 135-50", "L 228-1",
  "LP 245-10", "TIC 178172313", "PSR J0935+3312", "QSO B2227-399", "RX J0134.4+2638", "PKS J1349-1132", "[VV2006] J100145.1+022456",
  "(2010 BO127)", "879232 (2013 SL30)", "2001 QW322",
]) assert.equal(isCatalogDesignation(name), true, name);

// Names that people use.
for (const name of [
  "Sun", "Mars", "Sirius", "Betelgeuse", "M31 Andromeda Galaxy", "NGC 2241", "IC 434", "Titan", "Iapetus", "Pluto", "1 Ceres",
  "Walinskia", "Guo Shou-Jing", "Halley", "TRAPPIST-1", "Kepler-584", "Proxima Centauri", "3C 273", "Barnard's Star", "Large Magellanic Cloud",
]) assert.equal(isCatalogDesignation(name), false, name);

// Classes.
assert.equal(labelClass({ key: "sun", name: "Sun", objectType: "star" }), "major");
assert.equal(labelClass({ key: "moon", name: "Moon", objectType: "moon" }), "major");
assert.equal(labelClass({ key: "neptune", name: "Neptune", objectType: "planet" }), "major");
assert.equal(labelClass({ key: "titan", name: "Titan", objectType: "moon" }), "named");
assert.equal(labelClass({ key: "hip-32349", name: "Sirius", objectType: "star" }), "named");
assert.equal(labelClass({ key: "m31", name: "M31 Andromeda Galaxy", objectType: "galaxy" }), "named");
assert.equal(labelClass({ key: "exo-1", name: "TRAPPIST-1 b", objectType: "planet" }), "named", "an exoplanet is not a major body");
assert.equal(labelClass({ key: "jpl-sbdb-1", name: "Walinskia", objectType: "asteroid" }), "minor");
assert.equal(labelClass({ key: "jpl-sbdb-2", name: "Halley", objectType: "comet" }), "minor");
assert.equal(labelClass({ key: "jpl-sbdb-3", name: "(2010 BO127)", objectType: "asteroid" }), "designation");
assert.equal(labelClass({ key: "hip-10234", name: "HIP 10234", objectType: "star" }), "designation");
// Short catalog forms of star designations are not names that people use.
for (const name of ["bet Oph", "del Oph", "gam02 Sgr", "eta Sgr", "G Sco", "alf Ind", "eps Eri", "61 Cyg A", "Gl 725 A", "V645 Cen", "47 UMa", "SZ UMa", "q01 Eri", "alf CMa"]) {
  assert.equal(labelClass({ key: name, name, objectType: "star" }), "designation", name);
}
for (const name of ["Antares", "Altair", "Rigil Kentaurus", "Ross 128", "51 Peg b", "NGC 6231", "Milky Way", "M 31"]) {
  assert.equal(labelClass({ key: name, name, objectType: "star" }), "named", name);
}
// A spacecraft gets its label after the named objects.
assert.equal(labelClass({ key: "new-horizons", name: "New Horizons", objectType: "spacecraft" }), "minor");
assert.equal(labelClass({ key: "gaia-1", name: "Gaia DR3 6443636359270855552", objectType: "star" }), "designation");
assert.equal(labelClass({ key: "hip-10234", name: "HIP 10234", objectType: "star", selected: true }), "selected");
assert.deepEqual(["selected", "major", "named", "minor", "designation"].map((name) => labelClassRank(name as never)), [0, 1, 2, 3, 4]);
assert.equal(labelRank({ key: "mars", name: "Mars" }), 1);

// Order: class first, then the tie-break value, then the input order.
{
  const points: (LabelPoint & { distance: number })[] = [
    { key: "hip-1", name: "HIP 1", objectType: "star", distance: 1 },
    { key: "jpl-1", name: "Walinskia", objectType: "asteroid", distance: 2 },
    { key: "m31", name: "M31 Andromeda Galaxy", objectType: "galaxy", distance: 300 },
    { key: "mars", name: "Mars", objectType: "planet", distance: 80 },
    { key: "hip-32349", name: "Sirius", objectType: "star", distance: 20 },
    { key: "sun", name: "Sun", objectType: "star", distance: 5 },
    { key: "gaia-9", name: "Gaia DR3 9", objectType: "star", distance: 0, selected: true },
    { key: "earth", name: "Earth", objectType: "planet", distance: Number.NaN },
  ];
  assert.deepEqual(rankLabels(points, (point) => point.distance).map((point) => point.key),
    ["gaia-9", "sun", "mars", "earth", "hip-32349", "m31", "jpl-1", "hip-1"]);
  const equal = [{ key: "a", name: "Alpha" }, { key: "b", name: "Beta" }];
  assert.deepEqual(rankLabels(equal, () => 1).map((point) => point.key), ["a", "b"], "equal ranks keep the input order");
}

// Placement.
{
  const bounds: LabelRect = { left: 0, top: 0, right: 400, bottom: 300 };
  type Item = { key: string; x: number; y: number; width: number };
  const right = (item: Item): LabelRect => ({ left: item.x + 10, top: item.y - 11, right: item.x + 10 + item.width, bottom: item.y + 11 });
  const left = (item: Item): LabelRect => ({ left: item.x - 10 - item.width, top: item.y - 11, right: item.x - 10, bottom: item.y + 11 });
  const rectsFor = (item: Item) => [right(item), left(item)];

  // Two objects at almost the same place: the second label uses the second anchor.
  const sun: Item = { key: "sun", x: 200, y: 150, width: 40 };
  const mercury: Item = { key: "mercury", x: 204, y: 152, width: 60 };
  const venus: Item = { key: "venus", x: 202, y: 149, width: 50 };
  const placed = placeLabels([sun, mercury, venus], { rectsFor, bounds });
  assert.deepEqual(placed.map((label) => [label.item.key, label.anchorIndex]), [["sun", 0], ["mercury", 1]], "the third label has no free anchor");
  assert.equal(labelRectsOverlap(placed[0]!.rect, placed[1]!.rect), false);

  // A label must be inside the bounds, and the second anchor is used at the right edge.
  const edge: Item = { key: "edge", x: 395, y: 100, width: 50 };
  assert.deepEqual(placeLabels([edge], { rectsFor, bounds }).map((label) => label.anchorIndex), [1]);
  assert.deepEqual(placeLabels([{ key: "top", x: 100, y: 4, width: 50 }], { rectsFor, bounds }), []);

  // Exclusion areas (controls) and a shared occupancy list.
  const control: LabelRect = { left: 300, top: 80, right: 400, bottom: 120 };
  assert.deepEqual(placeLabels([{ key: "near-control", x: 280, y: 100, width: 40 }], { rectsFor, bounds, exclusions: [control] }).map((label) => label.anchorIndex), [1]);
  const occupied: LabelRect[] = [];
  placeLabels([sun], { rectsFor, bounds, occupied });
  assert.equal(occupied.length, 1);
  assert.deepEqual(placeLabels([{ key: "name", x: 205, y: 150, width: 30 }], { rectsFor: (item: Item) => [right(item)], bounds, occupied }), []);

  // The limit counts placed labels only.
  const row: Item[] = Array.from({ length: 6 }, (_, index) => ({ key: `p${index}`, x: 20 + index * 60, y: 250, width: 30 }));
  assert.equal(placeLabels(row, { rectsFor, bounds, limit: 3 }).length, 3);
  assert.equal(placeLabels([sun, venus, ...row], { rectsFor: (item: Item) => [right(item)], bounds, limit: 3 }).length, 3);
}

console.log("label rank tests passed");
