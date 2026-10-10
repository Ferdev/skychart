import { t } from "../i18n";
import { DATA_LABEL_KEYS } from "./dataLabelTranslations";

/**
 * The text of a label that a data module or the server gives in English (a Milky Way feature, a source link).
 * A label that has no key shows as it is.
 */
export function dataLabelText(label: string): string {
  const key = DATA_LABEL_KEYS[label];
  return key ? t(key) : label;
}
