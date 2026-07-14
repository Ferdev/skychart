import { formatNumber } from "../atlasFormatting";
import type { Body } from "../atlas/contracts";
import { finiteOptionalNumber } from "../catalog/catalogObjectMapper";
import { eclipticCartesianToSpherical, equatorialToGalactic, formatDecimalDegrees, formatDeclination, formatRightAscension } from "../coordinates";
import { formatPickerDistance } from "../destinationPicker";
import { t } from "../i18n";

/** Formats scientific values and coordinate systems consistently across object views. */
export class ScientificValueFormatter {
  constructor(private readonly auKm: () => number) {}

  formatDistance = (kilometers: number) => formatPickerDistance(kilometers, this.auKm());
  nullableDistance = (value: number | null | undefined) => finite(value) ? this.formatDistance(value) : t("value.unknown");
  nullableNumber = (value: number | null | undefined, digits: number) => finite(value) ? value.toFixed(digits) : t("value.unknown");
  nullableDegrees = (value: number | null | undefined) => finite(value) ? t("value.degrees", { value: value.toFixed(2) }) : t("value.unknown");
  nullableDays = (value: number | null | undefined) => {
    if (!finite(value)) return t("value.unknown");
    return value >= 365 ? t("value.years", { value: (value / 365.25).toFixed(2) }) : t("value.days", { value: value.toFixed(2) });
  };
  nullableLightYears = (value: number | null | undefined) => finite(value) ? `${formatNumber(value)} ly` : t("value.unknown");

  formatRightAscensionForBody = (body: Body) => {
    const coordinates = equatorialCoordinates(body);
    return coordinates ? `${formatRightAscension(coordinates.raDeg)} (${formatDecimalDegrees(coordinates.raDeg)})` : null;
  };
  formatDeclinationForBody = (body: Body) => {
    const coordinates = equatorialCoordinates(body);
    return coordinates ? `${formatDeclination(coordinates.decDeg)} (${formatDecimalDegrees(coordinates.decDeg)})` : null;
  };
  formatRaDecDecimal = (body: Body) => {
    const coordinates = equatorialCoordinates(body);
    return coordinates ? `${formatDecimalDegrees(coordinates.raDeg)}, ${formatDecimalDegrees(coordinates.decDeg)}` : null;
  };
  formatGalacticLongitude = (body: Body) => {
    const coordinates = galacticCoordinates(body);
    return coordinates ? formatDecimalDegrees(coordinates.longitudeDeg, 3) : null;
  };
  formatGalacticLatitude = (body: Body) => {
    const coordinates = galacticCoordinates(body);
    return coordinates ? formatDecimalDegrees(coordinates.latitudeDeg, 3) : null;
  };
  formatEclipticLongitude = (body: Body) => {
    const coordinates = eclipticCoordinates(body);
    return coordinates ? formatDecimalDegrees(coordinates.longitudeDeg, 3) : null;
  };
  formatEclipticLatitude = (body: Body) => {
    const coordinates = eclipticCoordinates(body);
    return coordinates ? formatDecimalDegrees(coordinates.latitudeDeg, 3) : null;
  };
  formatEclipticRadius = (body: Body) => {
    const coordinates = eclipticCoordinates(body);
    return coordinates ? `${formatNumber(coordinates.radiusAu)} AU` : null;
  };
  formatAuCoordinate = (value: number) => `${formatNumber(value)} AU`;
  readableOptionalModel = (value: string | null | undefined) => value ? readablePositionModel(value) : null;
  readableCatalogGroup = (value: string | null | undefined) => value ? readablePositionModel(value) : null;
  readablePositionModel = readablePositionModel;
}

export function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

export function formatFullDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "short", timeZone: "UTC",
  }).format(new Date(value));
}

function equatorialCoordinates(body: Body) {
  const raDeg = finiteOptionalNumber(body.catalog?.ra_deg);
  const decDeg = finiteOptionalNumber(body.catalog?.dec_deg);
  return raDeg == null || decDeg == null ? null : { raDeg, decDeg };
}

function galacticCoordinates(body: Body) {
  const coordinates = equatorialCoordinates(body);
  return coordinates ? equatorialToGalactic(coordinates) : null;
}

function eclipticCoordinates(body: Body) {
  return eclipticCartesianToSpherical(body.position.x_au, body.position.y_au, body.position.z_au);
}

function readablePositionModel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) || t("value.unknown");
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
