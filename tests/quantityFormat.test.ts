import assert from "node:assert/strict";
import {
  configureFormat,
  formatCount,
  formatDateTime,
  formatDistanceAu,
  formatDistanceKm,
  formatDuration,
  formatFixed,
  formatLightYears,
  formatLocale,
  formatPercent,
  formatQuantity,
  LIGHT_YEAR_KM,
  setFormatLocale,
} from "../src/format/quantity.ts";

const AU_KM = 149_597_870.7;
const DAY = 86_400;

// English: the cases of docs/ui-style.md.
setFormatLocale("en");
assert.equal(formatLocale(), "en");
assert.equal(formatDistanceKm(383_400), "383,400 km");
assert.equal(formatDistanceKm(383_412), "383,400 km", "four significant digits, all digits shown");
assert.equal(formatDistanceKm(1_400_000), "1.4 million km");
assert.equal(formatDistanceKm(1.61 * AU_KM), "1.61 AU");
assert.equal(formatDistanceKm(227_500 * LIGHT_YEAR_KM), "227,500 ly");
assert.equal(formatDistanceKm(2_050_000 * LIGHT_YEAR_KM), "2.05 million ly");
assert.equal(formatLightYears(9_460_000_000), "9.46 billion ly");
assert.equal(formatLightYears(9_461_234_567), "9.46 billion ly", "three significant digits in the word form");
assert.equal(formatCount(12_000), "12,000");
assert.equal(formatCount(2_334_000, { compact: true }), "2.33M");
assert.equal(formatQuantity(12_000), "12,000");
assert.equal(formatQuantity(999_960), "1 million", "a value that rounds to one million uses the word form");
assert.equal(formatQuantity(0.0934), "0.0934");
assert.equal(formatQuantity(0), "0");
assert.equal(formatQuantity(-1.61), "-1.61");
assert.equal(formatFixed(4.5, 2), "4.50");
assert.equal(formatPercent(0.25), "25%");

// Unit thresholds: km below 0.1 AU, AU below 0.1 ly, ly above.
assert.equal(formatDistanceKm(0.09 * AU_KM), "13.5 million km");
assert.equal(formatDistanceKm(0.1 * AU_KM), "0.1 AU");
assert.equal(formatDistanceKm(0.09 * LIGHT_YEAR_KM), "5,692 AU");
assert.equal(formatDistanceKm(0.1 * LIGHT_YEAR_KM), "0.1 ly");
assert.equal(formatDistanceAu(1), "1 AU");
assert.equal(formatDistanceAu(0), "0 km");
assert.equal(formatLightYears(0.05), "3,162 AU");
assert.equal(formatLightYears(4.2465), "4.247 ly");

// No output has an exponent or a kly, Mly, or Gly unit.
for (const exponent of [-9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21]) {
  for (const text of [formatQuantity(3.21 * 10 ** exponent), formatDistanceKm(3.21 * 10 ** exponent), formatLightYears(3.21 * 10 ** exponent)]) {
    assert.doesNotMatch(text, /\de[+-]?\d|×10|\b[kMG]ly\b/, text);
  }
}

// Durations.
assert.equal(formatDuration(0.25), "250 ms");
assert.equal(formatDuration(42), "42 s");
assert.equal(formatDuration(90), "1.5 min");
assert.equal(formatDuration(5 * 3_600), "5 h");
assert.equal(formatDuration(259 * DAY), "259 d");
assert.equal(formatDuration(12 * 365.25 * DAY), "12 yr");
assert.equal(formatDuration(12_000 * 365.25 * DAY), "12,000 yr");
assert.equal(formatDuration(2_500_000 * 365.25 * DAY), "2.5 million yr");

// Missing values use the configured text.
assert.equal(formatQuantity(Number.NaN), "unknown");
assert.equal(formatDistanceKm(Number.POSITIVE_INFINITY), "unknown");
assert.equal(formatDuration(Number.NaN), "unknown");
configureFormat({ unknown: "desconocido" });
assert.equal(formatCount(Number.NaN), "desconocido");
configureFormat({ unknown: "unknown" });

// Spanish: separators and words of the Spanish locale.
setFormatLocale("es");
assert.equal(formatDistanceKm(1.61 * AU_KM), "1,61 AU");
assert.equal(formatDistanceKm(383_400), "383.400 km");
assert.equal(formatDistanceKm(1_400_000), "1,4 millones km");
assert.equal(formatDistanceKm(227_500 * LIGHT_YEAR_KM), "227.500 ly");
assert.equal(formatLightYears(9_460_000_000), "9,46 mil millones ly");
assert.equal(formatCount(12_000), "12.000");

// German.
setFormatLocale("de");
assert.equal(formatDistanceKm(383_400), "383.400 km");
assert.equal(formatDistanceKm(1_400_000), "1,4 Millionen km");
assert.equal(formatDistanceKm(1.61 * AU_KM), "1,61 AU");
assert.equal(formatLightYears(2_050_000), "2,05 Millionen ly");
assert.equal(formatLightYears(9_460_000_000), "9,46 Milliarden ly");
assert.equal(formatCount(12_000), "12.000");

// Japanese.
setFormatLocale("ja");
assert.equal(formatDistanceKm(383_400), "383,400 km");
assert.equal(formatDistanceKm(1_400_000), "140万 km");
assert.equal(formatDistanceKm(1.61 * AU_KM), "1.61 AU");
assert.equal(formatLightYears(227_500), "227,500 ly");
assert.equal(formatLightYears(9_460_000_000), "94.6億 ly");
assert.equal(formatCount(12_000), "12,000");

// Units come from the configuration, so that a locale can give its own unit text.
configureFormat({ locale: "es", units: { ly: "al" } as never });
assert.equal(formatLightYears(4.2465), "4,247 al");
assert.equal(formatDistanceKm(383_400), "383.400 km", "other units keep their text");
configureFormat({ locale: "en", units: { ly: "ly" } as never });

// Dates use the application locale.
const instant = "2026-10-09T12:30:00Z";
assert.equal(formatDateTime(instant, { dateStyle: "medium", timeZone: "UTC" }), "Oct 9, 2026");
setFormatLocale("es");
assert.equal(formatDateTime(instant, { dateStyle: "medium", timeZone: "UTC" }), "9 oct 2026");
assert.equal(formatDateTime("not a date"), "unknown");
setFormatLocale("en");

console.log("quantity format tests passed");

// A coordinate keeps its precision from one million also, so that a short move changes the text.
assert.equal(formatQuantity(1.000312, 7, 7), "1.000312");
assert.equal(formatQuantity(1_000_158, 7, 7), "1.000158 million");
assert.notEqual(formatQuantity(1_000_158, 7, 7), formatQuantity(1_000_000, 7, 7));
assert.equal(formatQuantity(1_000_158), "1 million");
