export const DEFAULT_AU_KM = 149_597_870.7;
export const LIGHT_SPEED_KM_PER_SECOND = 299_792.458;
export const EARTH_MOON_AVERAGE_KM = 384_400;
export const EARTH_EQUATORIAL_CIRCUMFERENCE_KM = 40_075.017;
export const MARS_CLOSE_APPROACH_KM = 54_600_000;
export const LIGHT_YEAR_KM = 9_460_730_472_580.8;

export type Point3Au = {
  xAu: number;
  yAu: number;
  zAu: number;
};

export type EphemerisPoint3Au = {
  x_au: number;
  y_au: number;
  z_au: number;
};

export type Point3AuInput = Point3Au | EphemerisPoint3Au;

export type EducationalComparison = {
  key: string;
  label: string;
  value: number;
  unit: string;
  displayValue: string;
  description: string;
};

export type EducationalComparisonOptions = {
  auKm?: number;
  lightSpeedKmPerSecond?: number;
  includeMissionComparisons?: boolean;
};

export function distanceAu(a: Point3AuInput, b: Point3AuInput): number {
  const start = pointFrom(a);
  const end = pointFrom(b);
  return Math.hypot(end.xAu - start.xAu, end.yAu - start.yAu, end.zAu - start.zAu);
}

export function distanceKm(a: Point3AuInput, b: Point3AuInput, auKm = DEFAULT_AU_KM): number {
  return distanceAu(a, b) * auKm;
}

export function educationalComparisons(
  distanceKmValue: number,
  options: EducationalComparisonOptions = {}
): EducationalComparison[] {
  const auKm = options.auKm ?? DEFAULT_AU_KM;
  const lightSpeedKmPerSecond = options.lightSpeedKmPerSecond ?? LIGHT_SPEED_KM_PER_SECOND;
  const lightSeconds = distanceKmValue / lightSpeedKmPerSecond;
  const comparisons: EducationalComparison[] = [
    {
      key: "light_time",
      label: "Light time",
      value: lightSeconds,
      unit: "seconds",
      displayValue: formatDuration(lightSeconds),
      description: `Light crosses this distance in ${formatDuration(lightSeconds)}.`
    },
    {
      key: "astronomical_units",
      label: "Astronomical units",
      value: distanceKmValue / auKm,
      unit: "AU",
      displayValue: `${formatRatio(distanceKmValue / auKm)} AU`,
      description: "Distance expressed in Earth-Sun average distances."
    },
    {
      key: "earth_moon",
      label: "Earth-Moon spans",
      value: distanceKmValue / EARTH_MOON_AVERAGE_KM,
      unit: "Earth-Moon distances",
      displayValue: `${formatRatio(distanceKmValue / EARTH_MOON_AVERAGE_KM)}x`,
      description: "Compared with the average Earth-Moon distance."
    },
    {
      key: "earth_circumference",
      label: "Earth circumferences",
      value: distanceKmValue / EARTH_EQUATORIAL_CIRCUMFERENCE_KM,
      unit: "Earth circumferences",
      displayValue: `${formatRatio(distanceKmValue / EARTH_EQUATORIAL_CIRCUMFERENCE_KM)}x`,
      description: "Compared with Earth's equatorial circumference."
    }
  ];

  if (Math.abs(distanceKmValue) >= LIGHT_YEAR_KM * 0.001) {
    comparisons.push({
      key: "light_years",
      label: "Light-years",
      value: distanceKmValue / LIGHT_YEAR_KM,
      unit: "ly",
      displayValue: `${formatRatio(distanceKmValue / LIGHT_YEAR_KM)} ly`,
      description: "Distance expressed in light-years."
    });
  }

  if (options.includeMissionComparisons !== false) {
    comparisons.push({
      key: "mars_close_approach",
      label: "Mars close approaches",
      value: distanceKmValue / MARS_CLOSE_APPROACH_KM,
      unit: "Mars close approaches",
      displayValue: `${formatRatio(distanceKmValue / MARS_CLOSE_APPROACH_KM)}x`,
      description: "Compared with a favorable Earth-Mars close approach."
    });
  }

  return comparisons;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unknown";
  const abs = Math.abs(seconds);
  if (abs < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (abs < 60) return `${seconds.toFixed(1)} s`;
  if (abs < 3600) return `${(seconds / 60).toFixed(1)} min`;
  if (abs < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  if (abs < 31_557_600) return `${(seconds / 86_400).toFixed(1)} d`;
  return `${(seconds / 31_557_600).toFixed(2)} yr`;
}

export function formatRatio(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return "unknown";
  if (abs >= 1_000_000) return value.toExponential(2);
  if (abs >= 1000) return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3);
  if (abs >= 0.001) return value.toPrecision(3);
  return value.toExponential(2);
}

function pointFrom(point: Point3AuInput): Point3Au {
  if ("xAu" in point) return point;
  return {
    xAu: point.x_au,
    yAu: point.y_au,
    zAu: point.z_au
  };
}
