/**
 * The narration of an answer flight. A number is a value of a stored record, so the text of a
 * chip comes from the value and the language of the reader, never from the model. This module
 * must not import `i18n.ts`, so that node tests can import it.
 */
export type NarrationSegment =
  | { kind: "text"; text: string }
  | { kind: "object"; key: string; text: string }
  | { kind: "fact"; value: number; unit: string; keys: string[]; as_of?: string | null };
export type NarrationSentence = NarrationSegment[];
export type FlightSource = { key: string; name: string; catalog?: string | null; url: string };
export type FlightState = {
  slug: string;
  flight: string;
  status: "queued" | "running" | "published" | "refused" | "failed";
  refusal?: string;
  suggested_tour?: { slug: string; title: string } | null;
};

/** A value above this size is a word in the language of the reader: 2.5 million. */
const WORD_NUMBER_LIMIT = 1_000_000;
/** A record gives more digits than a sentence needs. */
const SIGNIFICANT_DIGITS = 4;
export const POLL_INTERVAL_MS = 2_000;
/** The job stops well before this time. After it, the reader gets a clear message. */
export const POLL_LIMIT_MS = 180_000;

export function formatFact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumSignificantDigits: SIGNIFICANT_DIGITS,
    ...(Math.abs(value) >= WORD_NUMBER_LIMIT ? { notation: "compact", compactDisplay: "long" } : {}),
  }).format(value);
}

/** The text of a chip. `unitLabel` gives the unit in the language of the reader. */
export function factText(segment: { value: number; unit: string }, locale: string, unitLabel: (unit: string) => string): string {
  const number = formatFact(segment.value, locale);
  return segment.unit ? `${number} ${unitLabel(segment.unit)}` : number;
}

export function sentenceText(sentence: NarrationSentence, locale: string, unitLabel: (unit: string) => string): string {
  return sentence.map((segment) => (segment.kind === "fact" ? factText(segment, locale, unitLabel) : segment.text)).join("");
}

/** The words that browser speech reads for one step. */
export function speechText(title: string, sentences: NarrationSentence[], locale: string, unitLabel: (unit: string) => string): string {
  return [title, ...sentences.map((sentence) => sentenceText(sentence, locale, unitLabel))].join(". ");
}

/** The record that a chip opens in the inspector. */
export function chipKey(segment: NarrationSegment): string | null {
  if (segment.kind === "object") return segment.key;
  return segment.kind === "fact" ? (segment.keys[0] ?? null) : null;
}

export type PollStep = "wait" | "play" | "refuse" | "fail" | "timeout";

export function pollStep(status: FlightState["status"], elapsedMs: number): PollStep {
  if (status === "published") return "play";
  if (status === "refused") return "refuse";
  if (status === "failed") return "fail";
  return elapsedMs >= POLL_LIMIT_MS ? "timeout" : "wait";
}
