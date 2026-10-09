/**
 * The one number rule of the interface (see docs/ui-style.md).
 *
 * - Numbers use the application locale, not the browser locale.
 * - Below one million: all digits with group separators, four significant digits maximum.
 * - From one million: words ("1.4 million km", "9.46 billion ly"), three significant digits maximum.
 * - Distances: km below 0.1 AU, AU below 0.1 ly, ly above. No kly, Mly, Gly, and no exponent form.
 *
 * This module must not import `i18n.ts`: node tests import the formatters, and `i18n.ts` needs `window`.
 * `i18n.ts` calls `configureFormat` at start and on each locale change.
 */

export const LIGHT_YEAR_KM = 9_460_730_472_580.8;
export const DEFAULT_AU_KM = 149_597_870.7;

const WORDS_FROM = 1_000_000;
const MEASURED_DIGITS = 4;
const WORD_DIGITS = 3;

export type FormatUnits = {
  km: string;
  au: string;
  ly: string;
  ms: string;
  s: string;
  min: string;
  h: string;
  d: string;
  yr: string;
};

export type FormatConfiguration = {
  locale: string;
  unknown: string;
  units: FormatUnits;
};

const DEFAULT_UNITS: FormatUnits = { km: "km", au: "AU", ly: "ly", ms: "ms", s: "s", min: "min", h: "h", d: "d", yr: "yr" };

let configuration: FormatConfiguration = { locale: "en", unknown: "unknown", units: DEFAULT_UNITS };
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

export function configureFormat(next: Partial<FormatConfiguration>): void {
  configuration = { ...configuration, ...next, units: { ...configuration.units, ...next.units } };
  numberFormats.clear();
  dateFormats.clear();
}

export function setFormatLocale(code: string): void {
  configureFormat({ locale: code });
}

export function formatLocale(): string {
  return configuration.locale;
}

function numberFormat(id: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let format = numberFormats.get(id);
  if (!format) {
    format = new Intl.NumberFormat(configuration.locale, options);
    numberFormats.set(id, format);
  }
  return format;
}

/**
 * A measured value with no unit: "383,400", "1.61", "1.4 million".
 * `maximumWordDigits` is for a value that must keep its precision from one million also,
 * such as a coordinate of a position ("1.000158 million").
 */
export function formatQuantity(value: number, maximumSignificantDigits = MEASURED_DIGITS, maximumWordDigits = WORD_DIGITS): string {
  if (!Number.isFinite(value)) return configuration.unknown;
  const digits = Math.min(21, Math.max(1, Math.round(maximumSignificantDigits)));
  // Round first, so that 999,960 becomes "1 million" and not "1,000,000".
  const rounded = Number(value.toPrecision(digits));
  if (Math.abs(rounded) >= WORDS_FROM) {
    const wordDigits = Math.min(digits, Math.max(1, Math.round(maximumWordDigits)));
    return numberFormat(`words:${wordDigits}`, { notation: "compact", compactDisplay: "long", maximumSignificantDigits: wordDigits }).format(value);
  }
  return numberFormat(`measured:${digits}`, { maximumSignificantDigits: digits }).format(value);
}

/** A value with a fixed number of decimals, for values such as magnitudes and angles. */
export function formatFixed(value: number, fractionDigits: number): string {
  if (!Number.isFinite(value)) return configuration.unknown;
  return numberFormat(`fixed:${fractionDigits}`, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}

/**
 * A count of things. All digits by default ("12,000").
 * The short form ("2.33M") is for counts in small spaces.
 */
export function formatCount(value: number, options: { compact?: boolean; maximumFractionDigits?: number } = {}): string {
  if (!Number.isFinite(value)) return configuration.unknown;
  if (options.compact) {
    const fractionDigits = options.maximumFractionDigits ?? 2;
    return numberFormat(`compact:${fractionDigits}`, { notation: "compact", maximumFractionDigits: fractionDigits }).format(value);
  }
  return numberFormat("count", { maximumFractionDigits: 0 }).format(value);
}

/** A share as a percentage, for example a sample rate. */
export function formatPercent(fraction: number, maximumFractionDigits = 1): string {
  if (!Number.isFinite(fraction)) return configuration.unknown;
  return numberFormat(`percent:${maximumFractionDigits}`, { style: "percent", maximumFractionDigits }).format(fraction);
}

/** A distance in kilometres, shown in km, AU, or ly as its size requires. */
export function formatDistanceKm(kilometers: number, options: { auKm?: number } = {}): string {
  if (!Number.isFinite(kilometers)) return configuration.unknown;
  const auKm = options.auKm && options.auKm > 0 ? options.auKm : DEFAULT_AU_KM;
  const magnitude = Math.abs(kilometers);
  const { units } = configuration;
  if (magnitude >= LIGHT_YEAR_KM * 0.1) return `${formatQuantity(kilometers / LIGHT_YEAR_KM)} ${units.ly}`;
  if (magnitude >= auKm * 0.1) return `${formatQuantity(kilometers / auKm)} ${units.au}`;
  return `${formatQuantity(kilometers)} ${units.km}`;
}

/** A distance in astronomical units, shown in km, AU, or ly as its size requires. */
export function formatDistanceAu(au: number, options: { auKm?: number } = {}): string {
  const auKm = options.auKm && options.auKm > 0 ? options.auKm : DEFAULT_AU_KM;
  return formatDistanceKm(au * auKm, { auKm });
}

/** A distance in light-years. Values below 0.1 ly change to AU or km. */
export function formatLightYears(lightYears: number, options: { auKm?: number } = {}): string {
  if (!Number.isFinite(lightYears)) return configuration.unknown;
  if (Math.abs(lightYears) >= 0.1) return `${formatQuantity(lightYears)} ${configuration.units.ly}`;
  return formatDistanceKm(lightYears * LIGHT_YEAR_KM, options);
}

/** A time span in seconds, shown in the largest unit that keeps the number easy to read. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return configuration.unknown;
  const magnitude = Math.abs(seconds);
  const { units } = configuration;
  const withUnit = (value: number, unit: string) => `${formatQuantity(value, 3)} ${unit}`;
  if (magnitude < 1) return withUnit(seconds * 1000, units.ms);
  if (magnitude < 60) return withUnit(seconds, units.s);
  if (magnitude < 3_600) return withUnit(seconds / 60, units.min);
  if (magnitude < 172_800) return withUnit(seconds / 3_600, units.h);
  const days = seconds / 86_400;
  if (Math.abs(days) < 730) return withUnit(days, units.d);
  return withUnit(days / 365.25, units.yr);
}

/** A date and time in the application locale. */
export function formatDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return configuration.unknown;
  const id = JSON.stringify(options);
  let format = dateFormats.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat(configuration.locale, options);
    dateFormats.set(id, format);
  }
  return format.format(date);
}
