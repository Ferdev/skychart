import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Translation parity guard: each English key has its own value in each of the eight other locales.
 *
 * The tables of `src/i18n.ts` are merged at module load, so the guard loads the module (with the Vite
 * transform, as the application does) and reads the merged tables. A key can be equal to English
 * (a name, a unit, `3D`) only when `tests/i18n_same_as_english.txt` lists it.
 */
const ROOT = new URL("..", import.meta.url).pathname;
const ALLOW_LIST_PATH = new URL("./i18n_same_as_english.txt", import.meta.url);

type Tables = Record<string, { strings: Record<string, string> }>;

async function loadTables(): Promise<Tables> {
  const stubs = globalThis as Record<string, unknown>;
  stubs.window = { location: { search: "", pathname: "/" }, localStorage: { getItem: () => null, setItem: () => undefined }, addEventListener: () => undefined, dispatchEvent: () => true };
  Object.defineProperty(globalThis, "navigator", { value: { languages: ["en"], language: "en" }, configurable: true });
  stubs.document = { documentElement: {}, querySelector: () => null, querySelectorAll: () => [] };
  const { createServer } = await import("vite");
  const server = await createServer({
    root: ROOT, configFile: false, appType: "custom", logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    return (await server.ssrLoadModule("/src/i18n.ts")).LOCALES as Tables;
  } finally {
    await server.close();
  }
}

/** Lines of the form `key locale` or `key *`. Text after `#` is a comment. */
function readAllowList(): Set<string> {
  const allowed = new Set<string>();
  for (const line of readFileSync(ALLOW_LIST_PATH, "utf8").split("\n")) {
    const [key, locale] = line.replace(/#.*$/, "").trim().split(/\s+/);
    if (key && locale) allowed.add(`${key} ${locale}`);
  }
  return allowed;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");

test("each English key has a value of its own in each locale", async () => {
  const tables = await loadTables();
  const allowed = readAllowList();
  const english = tables.en!.strings;
  const locales = Object.keys(tables).filter((locale) => locale !== "en");
  assert.deepEqual(locales.sort(), ["de", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-Hans"]);
  const problems: string[] = [];
  const used = new Set<string>();
  for (const locale of locales) {
    const strings = tables[locale]!.strings;
    for (const [key, text] of Object.entries(english)) {
      const value = strings[key];
      if (typeof value !== "string" || value.trim() === "") { problems.push(`${locale}: ${key} has no value`); continue; }
      if (placeholders(value) !== placeholders(text)) problems.push(`${locale}: ${key} has different placeholders`);
      if (value !== text) continue;
      const entry = allowed.has(`${key} ${locale}`) ? `${key} ${locale}` : allowed.has(`${key} *`) ? `${key} *` : null;
      if (entry) used.add(entry);
      else problems.push(`${locale}: ${key} is equal to English ("${text.slice(0, 40)}")`);
    }
    for (const key of Object.keys(strings)) if (!(key in english)) problems.push(`${locale}: ${key} is not an English key`);
  }
  const stale = [...allowed].filter((entry) => !used.has(entry));
  assert.deepEqual(problems.slice(0, 40), [], `${problems.length} translation problems`);
  assert.deepEqual(stale, [], "entries of the allow-list that are not necessary");
});
