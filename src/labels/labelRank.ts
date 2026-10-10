/**
 * One label rule for the 2D map, Sky view, and 3D mode.
 *
 * A label has a class. A better class gets its label first:
 * selected object, major body, named object, minor body, catalog designation.
 */

export type LabelClass = "selected" | "major" | "named" | "minor" | "designation";

export type LabelPoint = {
  key: string;
  name: string;
  objectType?: string | null;
  selected?: boolean;
};

export type LabelRect = { left: number; top: number; right: number; bottom: number };

const CLASS_RANK: Record<LabelClass, number> = { selected: 0, major: 1, named: 2, minor: 3, designation: 4 };

/** The Sun, the planets, and the Moon. */
const MAJOR_BODY_KEYS = new Set(["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune"]);

/** Small bodies and spacecraft. They get a label after the named stars, planets, and deep-sky objects. */
const MINOR_BODY_TYPES = new Set(["asteroid", "comet", "small_body", "spacecraft", "probe", "satellite"]);

/** Names that are a catalog number and not a name that people use. */
const DESIGNATION_PATTERNS: readonly RegExp[] = [
  /^(HIP|HD|HR|TYC|UCAC\d?|TIC|GJ|Gl|LHS|LP|LTT|BD|CD|CPD|WISE|WISEA|PSR|QSO|PKS|RX|SDSS|2MASS|2MASX|\d?eRASSU?|\d?XMM|\dRXS)\b/i,
  /^Gaia (E?DR\d)\b/i,
  /^[GL] \d+-\d+/,
  /^\[[^\]]+\]/,
  /\bJ\d{4,}(\.\d+)?[+-]\d{2,}/,
  // Minor planets: "(2010 BO127)", "879232 (2013 SL30)", "2001 QW322".
  /^\(\d{4} [A-Z]{1,2}\d*\)$/,
  /^\d+ \(\d{4} [A-Z]{1,2}\d*\)$/,
  /^\d{4} [A-Z]{1,2}\d*$/,
  // Star designations in the short catalog form: "bet Oph", "gam02 Sgr", "61 Cyg A", "G Sco", "V645 Cen".
  /^(alf|bet|gam|del|eps|zet|eta|tet|iot|kap|lam|mu\.?|nu\.?|ksi|omi|pi\.?|rho|sig|tau|ups|phi|chi|psi|ome)\d{0,2} [A-Z][A-Za-z]{2}( [A-D])?$/,
  /^(\d{1,3}|[A-Za-z]\d{0,2}|[A-Z]{1,2}\d{0,4}|V\d+) [A-Z][A-Za-z]{2}( [A-D])?$/,
];

export function isCatalogDesignation(name: string): boolean {
  const text = name.trim();
  return DESIGNATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function labelClass(point: LabelPoint): LabelClass {
  if (point.selected) return "selected";
  if (MAJOR_BODY_KEYS.has(point.key.toLowerCase())) return "major";
  if (isCatalogDesignation(point.name)) return "designation";
  if (MINOR_BODY_TYPES.has(point.objectType?.toLowerCase() ?? "")) return "minor";
  return "named";
}

/** Rank of a label class. A lower number gets its label first. */
export function labelClassRank(labelClassName: LabelClass): number {
  return CLASS_RANK[labelClassName];
}

export function labelRank(point: LabelPoint): number {
  return CLASS_RANK[labelClass(point)];
}

/**
 * Sorts label candidates: the class is first, and `tieBreak` orders the candidates of one class
 * (for example the distance from the view centre, or the magnitude). A lower tie-break value is first.
 */
export function rankLabels<T extends LabelPoint>(candidates: readonly T[], tieBreak: (candidate: T) => number): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, rank: labelRank(candidate), tie: finiteOrLast(tieBreak(candidate)), index }))
    .sort((a, b) => a.rank - b.rank || a.tie - b.tie || a.index - b.index)
    .map((entry) => entry.candidate);
}

export function labelRectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export type PlaceLabelsOptions<T> = {
  /** The rectangles that one label can use, in order of preference (first anchor, then second anchor). */
  rectsFor: (candidate: T) => readonly LabelRect[];
  /** A label must be fully inside this rectangle. */
  bounds: LabelRect;
  /** Areas of controls and panels. A label must not touch them. */
  exclusions?: readonly LabelRect[];
  /** Rectangles that are already in use. Each placed label is added, so that two label groups can share one list. */
  occupied?: LabelRect[];
  /** Maximum number of labels. */
  limit?: number;
};

export type PlacedLabel<T> = { item: T; rect: LabelRect; anchorIndex: number };

/**
 * Gives each candidate, in the given order, the first of its rectangles that is free.
 * A candidate with no free rectangle gets no label.
 */
export function placeLabels<T>(candidates: readonly T[], options: PlaceLabelsOptions<T>): PlacedLabel<T>[] {
  const occupied = options.occupied ?? [];
  const exclusions = options.exclusions ?? [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const placed: PlacedLabel<T>[] = [];
  for (const item of candidates) {
    if (placed.length >= limit) break;
    const rects = options.rectsFor(item);
    const anchorIndex = rects.findIndex((rect) =>
      rectInside(rect, options.bounds)
      && !exclusions.some((area) => labelRectsOverlap(area, rect))
      && !occupied.some((used) => labelRectsOverlap(used, rect)));
    if (anchorIndex < 0) continue;
    const rect = rects[anchorIndex]!;
    occupied.push(rect);
    placed.push({ item, rect, anchorIndex });
  }
  return placed;
}

function rectInside(rect: LabelRect, bounds: LabelRect): boolean {
  return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
}

function finiteOrLast(value: number): number {
  return Number.isFinite(value) ? value : Number.MAX_VALUE;
}
