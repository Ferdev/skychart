import { OBJECT_NAME_TRANSLATIONS } from "./objectNameTranslations.ts";

/**
 * Local names of the core Solar System bodies (for example `Marte` for Mars).
 * The catalog has the English names. The search uses the local names of all languages as tokens,
 * and a result row shows the local name of the active language as second text.
 *
 * This module must not import `i18n.ts`: node tests import it, and `i18n.ts` needs `window`.
 */

/** Lower case with no accents, so that `Jupiter` finds `Júpiter`. */
export function foldName(text: string): string {
  return text.trim().normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const namesByKey = new Map<string, Set<string>>();
const keysByName = new Map<string, Set<string>>();
for (const names of Object.values(OBJECT_NAME_TRANSLATIONS)) {
  for (const [key, name] of Object.entries(names)) {
    const folded = foldName(name);
    if (!folded) continue;
    if (!namesByKey.has(key)) namesByKey.set(key, new Set());
    namesByKey.get(key)!.add(folded);
    if (!keysByName.has(folded)) keysByName.set(folded, new Set());
    keysByName.get(folded)!.add(key);
  }
}

/** The local name of a body in a locale, or null when the locale uses the catalog name. */
export function localObjectName(key: string, locale: string, catalogName?: string): string | null {
  const name = OBJECT_NAME_TRANSLATIONS[locale]?.[key.toLowerCase()];
  if (!name || (catalogName !== undefined && foldName(name) === foldName(catalogName))) return null;
  return name;
}

/** The local names of a body in all languages, in the folded form. */
export function localObjectNameTokens(key: string): string[] {
  return [...(namesByKey.get(key.toLowerCase()) ?? [])];
}

/** True when the text is a local name of this body in one language or more. */
export function isLocalObjectName(key: string, text: string): boolean {
  return namesByKey.get(key.toLowerCase())?.has(foldName(text)) ?? false;
}

/**
 * Puts the bodies whose local name is the query at the start of a result list.
 * The order of the other results does not change.
 */
export function localNameMatchesFirst<T extends { key: string }>(bodies: readonly T[], query: string): T[] {
  const keys = keysByName.get(foldName(query));
  if (!keys) return [...bodies];
  return [...bodies.filter((body) => keys.has(body.key.toLowerCase())), ...bodies.filter((body) => !keys.has(body.key.toLowerCase()))];
}
