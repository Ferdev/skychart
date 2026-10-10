import assert from "node:assert/strict";
import { test } from "node:test";
import { foldName, isLocalObjectName, localNameMatchesFirst, localObjectName, localObjectNameTokens } from "../src/i18n/objectNames.ts";
import { OBJECT_NAME_TRANSLATIONS } from "../src/i18n/objectNameTranslations.ts";

const CORE_KEYS = ["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "phobos", "deimos",
  "io", "europa", "ganymede", "callisto", "mimas", "enceladus", "tethys", "dione", "rhea", "titan", "iapetus"];

test("each of the eight locales has a name for each of the 24 core bodies", () => {
  assert.deepEqual(Object.keys(OBJECT_NAME_TRANSLATIONS).sort(), ["de", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-Hans"]);
  for (const [locale, names] of Object.entries(OBJECT_NAME_TRANSLATIONS)) {
    for (const key of CORE_KEYS) assert.ok(names[key]?.trim(), `${locale} has no name for ${key}`);
    assert.equal(Object.keys(names).length, CORE_KEYS.length, locale);
  }
});

test("the local name of a body is known for its locale", () => {
  assert.equal(localObjectName("mars", "es"), "Marte");
  assert.equal(localObjectName("moon", "es"), "Luna");
  assert.equal(localObjectName("jupiter", "es"), "Júpiter");
  assert.equal(localObjectName("mars", "en"), null);
  // A local name that is the catalog name is not a second name.
  assert.equal(localObjectName("venus", "es", "Venus"), null);
  assert.equal(localObjectName("mars", "es", "Mars"), "Marte");
  assert.equal(localObjectName("m31", "es"), null);
});

test("a search with a local name finds the body with or with no accent", () => {
  assert.ok(localObjectNameTokens("mars").includes("marte"));
  assert.ok(localObjectNameTokens("jupiter").includes(foldName("Júpiter")));
  assert.equal(isLocalObjectName("jupiter", "jupiter"), true);
  assert.equal(isLocalObjectName("mars", "Marte"), true);
  assert.equal(isLocalObjectName("mars", "Tierra"), false);
  assert.deepEqual(localObjectNameTokens("m31"), []);
});

test("an exact local name match is the first result", () => {
  const results = [{ key: "martel" }, { key: "exoplanet-x" }, { key: "mars" }];
  assert.deepEqual(localNameMatchesFirst(results, "Marte").map((body) => body.key), ["mars", "martel", "exoplanet-x"]);
  assert.deepEqual(localNameMatchesFirst(results, "mar").map((body) => body.key), ["martel", "exoplanet-x", "mars"]);
});
