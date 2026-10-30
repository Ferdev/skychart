/**
 * Target lists: the parser, the state of a matched row, and the CSV export.
 * The list stays in this browser. This module must not import `i18n.ts`, so that node tests can import it.
 */
export const MAX_TARGET_ROWS = 500;

export type TargetInput = { line: number; input: string; name?: string; ra_deg?: number; dec_deg?: number };
export type ParsedTargetList = { rows: TargetInput[]; total: number };

export type TargetObject = {
  key: string;
  name: string;
  object_type: string;
  catalog_group: string;
  source?: { label?: string; url?: string } | null;
  astrometry?: { ra_deg?: number | null; dec_deg?: number | null } | null;
  position?: { x_au?: number | null; y_au?: number | null } | null;
};
export type TargetCandidate = { key: string; name: string; object_type: string; catalog_group: string };
export type TargetMatchRow = {
  input: string;
  status: "matched" | "ambiguous" | "unmatched";
  object?: TargetObject;
  candidates?: TargetCandidate[];
  separation_arcsec?: number | null;
  duplicate_of?: number | null;
};

const fold = (value: string) => value.trim().toLowerCase();

function splitFields(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  const fields: string[] = [];
  let current = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { fields.push(current); current = ""; }
    else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** Degrees from a decimal or sexagesimal value. A sexagesimal right ascension is in hours. */
function angle(value: string, hours: boolean): number | null {
  const text = value.trim().replace(/[−–]/g, "-");
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = /^([+-]?)(\d{1,3})[\s:hd°]+(\d{1,2})[\s:m'′]+(\d{1,2}(?:\.\d+)?)[s"″]?$/i.exec(text);
  if (!parts) return null;
  const magnitude = Number(parts[2]) + Number(parts[3]) / 60 + Number(parts[4]) / 3600;
  return (parts[1] === "-" ? -1 : 1) * magnitude * (hours ? 15 : 1);
}

/** A position from one text, as two decimal values or as two sexagesimal values. */
export function parsePosition(text: string): { ra_deg: number; dec_deg: number } | null {
  const value = text.trim();
  const pair = /^(\S+)[\s,;]+(\S+)$/.exec(value);
  const six = /^(\d{1,2}\s+\d{1,2}\s+\d{1,2}(?:\.\d+)?)[\s,;]+([+-−]?\d{1,3}\s+\d{1,2}\s+\d{1,2}(?:\.\d+)?)$/.exec(value);
  const match = six ?? pair;
  if (!match) return null;
  const ra = angle(match[1]!, true), dec = angle(match[2]!, false);
  if (ra === null || dec === null || ra < 0 || ra > 360 || Math.abs(dec) > 90) return null;
  return { ra_deg: ra, dec_deg: dec };
}

export function parseTargetList(text: string): ParsedTargetList {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  let columns: { name: number; ra: number; dec: number } | null = null;
  const rows: TargetInput[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const fields = splitFields(line);
    if (!columns && rows.length === 0) {
      const titles = fields.map(fold);
      const ra = titles.findIndex((title) => ["ra", "ra_deg", "raj2000", "right ascension"].includes(title));
      const dec = titles.findIndex((title) => ["dec", "dec_deg", "dej2000", "decj2000", "declination"].includes(title));
      const name = titles.findIndex((title) => ["name", "object", "target", "id", "designation"].includes(title));
      if (name >= 0 || (ra >= 0 && dec >= 0)) {
        columns = { name, ra, dec };
        return;
      }
    }
    if (columns) {
      const position = columns.ra >= 0 && columns.dec >= 0 ? parsePosition(`${fields[columns.ra] ?? ""} ${fields[columns.dec] ?? ""}`) : null;
      const name = columns.name >= 0 ? fields[columns.name] ?? "" : "";
      if (name) rows.push({ line: index + 1, input: name, name });
      else if (position) rows.push({ line: index + 1, input: `${fields[columns.ra]} ${fields[columns.dec]}`, ...position });
      return;
    }
    const position = parsePosition(line);
    if (position) rows.push({ line: index + 1, input: line, ...position });
    else rows.push({ line: index + 1, input: fields[0] || line, name: fields[0] || line });
  });
  return { rows, total: rows.length };
}

/** The body of a row in the batch request. */
export function matchRequestRow(row: TargetInput): Record<string, string | number> {
  return row.name === undefined ? { ra_deg: row.ra_deg!, dec_deg: row.dec_deg! } : { name: row.name };
}

/** A field of a CSV file. Text that a spreadsheet can run as a formula is marked as plain text. */
function csvField(value: string | number | null | undefined, text = true): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = text && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function targetListCsv(rows: readonly TargetMatchRow[]): string {
  const header = ["row", "input", "status", "key", "name", "object_type", "ra_deg", "dec_deg", "separation_arcsec", "catalog_group", "source", "source_url", "duplicate_of_row"];
  const lines = rows.map((row, index) => {
    const object = row.object;
    return [
      csvField(index + 1, false), csvField(row.input), csvField(row.status), csvField(object?.key), csvField(object?.name), csvField(object?.object_type),
      csvField(object?.astrometry?.ra_deg, false), csvField(object?.astrometry?.dec_deg, false),
      csvField(row.separation_arcsec === undefined || row.separation_arcsec === null ? null : Number(row.separation_arcsec.toFixed(3)), false),
      csvField(object?.catalog_group), csvField(object?.source?.label), csvField(object?.source?.url),
      csvField(row.duplicate_of === undefined || row.duplicate_of === null ? null : row.duplicate_of + 1, false),
    ].join(",");
  });
  return `${[header.join(","), ...lines].join("\r\n")}\r\n`;
}

/** One marker for each matched object. A repeated row adds no marker. */
export function targetMarkers(rows: readonly TargetMatchRow[]) {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const object = row.object;
    if (row.status !== "matched" || !object || seen.has(object.key)) return [];
    seen.add(object.key);
    return [{
      key: object.key,
      name: object.name,
      xAu: object.position?.x_au ?? null,
      yAu: object.position?.y_au ?? null,
      raDeg: object.astrometry?.ra_deg ?? null,
      decDeg: object.astrometry?.dec_deg ?? null,
    }];
  });
}
