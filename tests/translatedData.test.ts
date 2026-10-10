import assert from "node:assert/strict";
import { test } from "node:test";
import { constellationName, LATIN_CONSTELLATION_NAMES, LOCAL_CONSTELLATION_NAMES } from "../src/i18n/constellationNames.ts";
import { CONSTELLATIONS } from "../src/sky/constellations.ts";
import { CURATED_MEDIA_KEYS, ENGLISH_MEDIA_TEXT, MEDIA_TEXT_EN, objectMediaItemsFor, type MediaText } from "../src/objectMedia.ts";
import { MILKY_WAY_MODEL } from "../src/galacticModel.ts";
import { readFileSync } from "node:fs";

const LOCALES = ["de", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-Hans"];

test("each locale has a different name for each constellation figure of the atlas", () => {
  assert.deepEqual([...LATIN_CONSTELLATION_NAMES], CONSTELLATIONS.map((figure) => figure.name), "the name list follows the figure list");
  assert.deepEqual(Object.keys(LOCAL_CONSTELLATION_NAMES).sort(), LOCALES);
  for (const [locale, names] of Object.entries(LOCAL_CONSTELLATION_NAMES)) {
    assert.equal(names.length, LATIN_CONSTELLATION_NAMES.length, locale);
    for (const [index, name] of names.entries()) assert.ok(name.trim(), `${locale} has no name for ${LATIN_CONSTELLATION_NAMES[index]}`);
    assert.equal(new Set(names).size, names.length, `${locale} has a name two times`);
  }
});

test("a constellation name follows the language, and the IAU name is the fallback", () => {
  assert.equal(constellationName("Ursa Major", "es"), "Osa Mayor");
  assert.equal(constellationName("Ursa Major", "de"), "Großer Bär");
  assert.equal(constellationName("Ursa Major", "ja"), "おおぐま座");
  assert.equal(constellationName("Orion", "en"), "Orion");
  assert.equal(constellationName("Orion", "xx"), "Orion");
  assert.equal(constellationName("Not a constellation", "es"), "Not a constellation");
  assert.notEqual(constellationName("Serpens Caput", "es"), constellationName("Serpens Cauda", "es"));
});

test("each locale has a title and an alternative text for each curated image", async () => {
  assert.equal(CURATED_MEDIA_KEYS.length, 27);
  for (const locale of LOCALES) {
    const module = await import(`../src/object/curatedSummaries/${locale}.ts`) as { CURATED_MEDIA_TEXT: Record<string, { title: string; alt: string }> };
    assert.deepEqual(Object.keys(module.CURATED_MEDIA_TEXT).sort(), [...CURATED_MEDIA_KEYS].sort(), locale);
    for (const [key, text] of Object.entries(module.CURATED_MEDIA_TEXT)) {
      assert.ok(text.title.trim() && text.alt.trim(), `${locale} ${key}`);
    }
  }
});

test("the media cards use the text source, and English is the default", () => {
  const mars = { key: "mars", name: "Mars", object_type: "planet" };
  const english = objectMediaItemsFor(mars)[0]!;
  assert.equal(english.badge, "Curated NASA image");
  assert.equal(english.title, "Tharsis Volcanoes and Valles Marineris");
  assert.equal(english.license, "NASA Image and Video Library", "the name of the library is a proper name");

  const fake: MediaText = {
    translate: (key, params = {}) => `[${key}${Object.keys(params).length ? ` ${Object.values(params).join(" ")}` : ""}]`,
    curated: (key) => (key === "mars" ? { title: "Título de Marte", alt: "Texto de Marte" } : undefined),
  };
  const local = objectMediaItemsFor(mars, undefined, fake)[0]!;
  assert.equal(local.badge, "[media.badge.curated]");
  assert.equal(local.title, "Título de Marte");
  assert.equal(local.alt, "Texto de Marte");
  // An object with no local text keeps the English title.
  assert.equal(objectMediaItemsFor({ key: "venus", name: "Venus" }, undefined, fake)[0]!.title, "Venus - Global View Centered at 90 Degrees East Longitude");

  // A survey card: the English sentences are the same as before the text had keys.
  const galaxy = { key: "ngc-1", name: "NGC 1", object_type: "galaxy", catalog: { ra_deg: 10, dec_deg: 20 } };
  const [dss2, legacy] = objectMediaItemsFor(galaxy);
  assert.equal(dss2!.title, "NGC 1 all-sky context");
  assert.equal(dss2!.description, "Reliable all-sky reference at RA 10.000 deg, Dec 20.000 deg.");
  assert.equal(legacy!.description, "Optical color cutout at RA 10.000 deg, Dec 20.000 deg. Coverage follows the DR11 survey footprint.");
  assert.equal(legacy!.fallback!.title, "NGC 1 in AllWISE infrared");
  assert.equal(objectMediaItemsFor(galaxy, undefined, fake)[0]!.title, "[media.dss2.title NGC 1]");
  assert.equal(ENGLISH_MEDIA_TEXT.translate("media.survey.moving", { name: "Ceres" }), MEDIA_TEXT_EN["media.survey.moving"].replace("{name}", "Ceres"));
});

test("each Milky Way label that the map draws has a translation key", () => {
  const table = readFileSync(new URL("../src/i18n/dataLabelTranslations.ts", import.meta.url), "utf8");
  const keys = table.split("export const DATA_LABEL_KEYS")[1]!.split("};")[0]!;
  const labels = [...MILKY_WAY_MODEL.features.filter((feature) => feature.labelPoint).map((feature) => feature.label), ...MILKY_WAY_MODEL.markers.map((marker) => marker.label)];
  assert.ok(labels.length >= 6);
  for (const label of labels) assert.ok(keys.includes(`"${label}": "milkyWay.`), `${label} has no key in DATA_LABEL_KEYS`);
});
