import { COMMUNITY_TRANSLATIONS } from "./communityTranslations";
import { DATA_LABEL_TRANSLATIONS } from "./dataLabelTranslations";
import { FIELD_TRANSLATIONS } from "./fieldTranslations";
import { OBJECT_TRANSLATIONS } from "./objectTranslations";
import { SEARCH_TRANSLATIONS } from "./searchTranslations";
import { SETTINGS_TRANSLATIONS } from "./settingsTranslations";
import { SHELL_TRANSLATIONS } from "./shellTranslations";
import { SKY_TRANSLATIONS } from "./skyTranslations";
import { TYPE_TRANSLATIONS } from "./typeTranslations";
import { UNIVERSE3D_TRANSLATIONS } from "./universe3dTranslations";

const LOCALE_CODES = ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"] as const;

/** Each area module has all nine locales. Add a new area module to this list. */
const AREAS: readonly Record<string, Record<string, string>>[] = [
  TYPE_TRANSLATIONS,
  SHELL_TRANSLATIONS,
  SEARCH_TRANSLATIONS,
  OBJECT_TRANSLATIONS,
  FIELD_TRANSLATIONS,
  SETTINGS_TRANSLATIONS,
  SKY_TRANSLATIONS,
  UNIVERSE3D_TRANSLATIONS,
  DATA_LABEL_TRANSLATIONS,
  COMMUNITY_TRANSLATIONS,
];

/** The text of all area modules, merged for each locale. `i18n.ts` puts it on top of the main table. */
export const AREA_TRANSLATIONS: Record<(typeof LOCALE_CODES)[number], Record<string, string>> = Object.fromEntries(
  LOCALE_CODES.map((locale) => [locale, Object.assign({}, ...AREAS.map((area) => area[locale] ?? {}))]),
) as Record<(typeof LOCALE_CODES)[number], Record<string, string>>;
