import assert from "node:assert/strict";
import { configureTypeLabels, normalizeObjectType, objectTypeLabel, objectTypeLabelKey } from "../src/format/objectTypeLabel.ts";
import { TYPE_TRANSLATIONS } from "../src/i18n/typeTranslations.ts";

// Keys: one name source for each type, singular and plural.
assert.equal(objectTypeLabelKey("star"), "type.star");
assert.equal(objectTypeLabelKey("star", "many"), "typePlural.star");
assert.equal(objectTypeLabelKey("dwarf_planet"), "type.dwarfPlanet");
assert.equal(objectTypeLabelKey("planet_candidate"), "exoplanet.typeCandidate");
assert.equal(objectTypeLabelKey("planet_candidate", "many"), "typePlural.planetCandidate");
assert.equal(objectTypeLabelKey(null), "type.object");
assert.equal(objectTypeLabelKey(""), "type.object");
assert.equal(objectTypeLabelKey("radio_source"), null);
assert.equal(normalizeObjectType(" Star Cluster "), "star_cluster");

// With no translation function, a known type shows its catalog word in sentence case.
assert.equal(objectTypeLabel("active_galaxy"), "Active galaxy");
assert.equal(objectTypeLabel("radio_source"), "Radio source");
assert.equal(objectTypeLabel("radio_source", "many"), "Radio source");
assert.equal(objectTypeLabel(undefined), "Unknown");

// With a translation function, the helper returns the translated name.
const english: Record<string, string> = {
  ...TYPE_TRANSLATIONS.en,
  "type.star": "Star",
  "type.galaxy": "Galaxy",
  "type.object": "Object",
  "exoplanet.typeCandidate": "Planet candidate",
};
configureTypeLabels((key) => english[key] ?? key);
assert.equal(objectTypeLabel("star"), "Star");
assert.equal(objectTypeLabel("star", "many"), "Stars");
assert.equal(objectTypeLabel("GALAXY", "many"), "Galaxies");
assert.equal(objectTypeLabel("planet_candidate"), "Planet candidate");
assert.equal(objectTypeLabel("planet_candidate", "many"), "Planet candidates");
assert.equal(objectTypeLabel("nebula", "many"), "Nebulae");
assert.equal(objectTypeLabel(null), "Object");
assert.equal(objectTypeLabel("moon"), "Moon", "a key with no value uses the sentence-case word");
assert.equal(objectTypeLabel("radio_source"), "Radio source");

// Each locale has a plural name for each type, and the seven locales with no singular names in the main table get them here.
const pluralKeys = Object.keys(TYPE_TRANSLATIONS.en);
assert.equal(pluralKeys.length, 21);
assert.deepEqual(Object.keys(TYPE_TRANSLATIONS).sort(), ["de", "en", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-Hans"]);
for (const [locale, strings] of Object.entries(TYPE_TRANSLATIONS)) {
  for (const key of pluralKeys) assert.ok(strings[key]?.trim(), `${locale} has no value for ${key}`);
  const singular = Object.keys(strings).filter((key) => key.startsWith("type."));
  assert.equal(singular.length, locale === "en" || locale === "es" ? 0 : 19, `${locale} singular names`);
  for (const [key, value] of Object.entries(strings)) {
    assert.equal(value, value.trim(), `${locale} ${key}`);
    assert.doesNotMatch(value, /_/, `${locale} ${key} must not show a catalog code`);
  }
}
assert.equal(TYPE_TRANSLATIONS.es["typePlural.galaxy"], "Galaxias");
assert.equal(TYPE_TRANSLATIONS.de["type.blackHole"], "Schwarzes Loch");

console.log("object type label tests passed");
