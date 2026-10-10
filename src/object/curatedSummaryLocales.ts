import type { MediaText, MediaTextKey } from "../objectMedia";
import { CURATED_OBJECT_SUMMARIES } from "./curatedObjectSummaries";

type CuratedMediaText = { title: string; alt: string };
/** The curated texts of one locale: the object summaries, and the titles and alternative texts of the curated images. */
type CuratedLocaleModule = { CURATED_OBJECT_SUMMARIES: Record<string, string>; CURATED_MEDIA_TEXT: Record<string, CuratedMediaText> };

/** One module for each locale. The browser loads only the module of the active locale. */
const LOADERS: Record<string, () => Promise<CuratedLocaleModule>> = {
  es: () => import("./curatedSummaries/es"),
  fr: () => import("./curatedSummaries/fr"),
  de: () => import("./curatedSummaries/de"),
  "pt-BR": () => import("./curatedSummaries/pt-BR"),
  it: () => import("./curatedSummaries/it"),
  "zh-Hans": () => import("./curatedSummaries/zh-Hans"),
  ja: () => import("./curatedSummaries/ja"),
  ko: () => import("./curatedSummaries/ko"),
};

const loaded = new Map<string, CuratedLocaleModule>();

/** Loads the curated summaries of a locale. English needs no load. A failed load keeps the English text. */
export async function loadCuratedSummaries(locale: string): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(LOADERS, locale) || loaded.has(locale)) return;
  try {
    const { CURATED_OBJECT_SUMMARIES: summaries, CURATED_MEDIA_TEXT: media } = await LOADERS[locale]();
    loaded.set(locale, { CURATED_OBJECT_SUMMARIES: summaries, CURATED_MEDIA_TEXT: media });
  } catch {
    // The locale stays unloaded. The English text is shown, and a later call can try again.
  }
}

/** The curated summary of an object in the given locale, or the English text when the locale has none. */
export function curatedObjectSummary(key: string, locale: string): string | undefined {
  return loaded.get(locale)?.CURATED_OBJECT_SUMMARIES[key] ?? CURATED_OBJECT_SUMMARIES[key];
}

/**
 * The text source of the media cards in the application language. The titles and alternative texts of the
 * curated images come from the locale module that `followCuratedSummaryLocale` loads; English is in `objectMedia.ts`.
 */
export function mediaTextFor(locale: () => string, translate: (key: string, params?: Record<string, string | number>) => string): MediaText {
  return {
    translate: (key: MediaTextKey, params) => translate(key, params),
    curated: (key) => loaded.get(locale())?.CURATED_MEDIA_TEXT[key],
  };
}

/**
 * Gives the curated summaries in the application language.
 * The record follows `locale()`: it loads the texts of the active language at start and after each language change,
 * and calls `ready` when new texts are there, so that the caller can show them.
 */
export function followCuratedSummaryLocale(locale: () => string, ready: () => void): Record<string, string> {
  const load = () => {
    const code = locale();
    void loadCuratedSummaries(code).then(() => { if (locale() === code && loaded.has(code)) ready(); });
  };
  window.addEventListener("cosmic-atlas:locale-change", load);
  load();
  return new Proxy<Record<string, string>>({}, {
    get: (_target, key) => typeof key === "string" ? curatedObjectSummary(key, locale()) : undefined,
  });
}
