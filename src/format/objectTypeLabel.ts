/**
 * The one source of object type names in the interface (see docs/ui-style.md).
 * Names are in sentence case: singular for one object, plural for a group.
 *
 * This module must not import `i18n.ts`, so that node tests can import it.
 * `i18n.ts` gives the translation function with `configureTypeLabels`.
 */

export type TypeLabelForm = "one" | "many";

type Translate = (key: string) => string;

/** Translation key suffix of each object type that the catalogs use. */
const TYPE_KEY_NAMES: Readonly<Record<string, string>> = {
  star: "star",
  planet: "planet",
  planet_candidate: "planetCandidate",
  moon: "moon",
  dwarf_planet: "dwarfPlanet",
  galaxy: "galaxy",
  quasar: "quasar",
  active_galaxy: "activeGalaxy",
  black_hole: "blackHole",
  pulsar: "pulsar",
  nebula: "nebula",
  star_cluster: "starCluster",
  xray_source: "xraySource",
  xray_extended: "xrayExtended",
  asterism: "asterism",
  milky_way_patch: "milkyWayPatch",
  asteroid: "asteroid",
  comet: "comet",
  spacecraft: "spacecraft",
  small_body: "smallBody",
  unknown: "object",
};

/** Singular names that have their key in a different translation area. */
const SINGULAR_KEY_OVERRIDES: Readonly<Record<string, string>> = {
  planet_candidate: "exoplanet.typeCandidate",
};

let translate: Translate = (key) => key;

export function configureTypeLabels(next: Translate): void {
  translate = next;
}

export function normalizeObjectType(type: string | null | undefined): string {
  return type?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "unknown";
}

/** The translation key of a type name, or null when the type has no key. */
export function objectTypeLabelKey(type: string | null | undefined, form: TypeLabelForm = "one"): string | null {
  const normalized = normalizeObjectType(type);
  const name = TYPE_KEY_NAMES[normalized];
  if (!name) return null;
  if (form === "many") return `typePlural.${name}`;
  return SINGULAR_KEY_OVERRIDES[normalized] ?? `type.${name}`;
}

/** The name of an object type: `objectTypeLabel("dwarf_planet")` is "Dwarf planet", and with "many" it is "Dwarf planets". */
export function objectTypeLabel(type: string | null | undefined, form: TypeLabelForm = "one"): string {
  const key = objectTypeLabelKey(type, form);
  if (key) {
    const text = translate(key);
    if (text && text !== key) return text;
  }
  // A type with no key: show the catalog word in sentence case. The form of the word does not change.
  const words = normalizeObjectType(type).replace(/_+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Object";
}
