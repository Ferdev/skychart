export const DEFAULT_AU_KM = 149_597_870.7;
export const LIGHT_SPEED_KM_PER_SECOND = 299_792.458;
export const EARTH_MOON_AVERAGE_KM = 384_400;
export const EARTH_EQUATORIAL_CIRCUMFERENCE_KM = 40_075.017;
export const MARS_CLOSE_APPROACH_KM = 54_600_000;
export const VOYAGER_ONE_DAILY_DISTANCE_KM = 17 * 86_400;

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

export type BodyLike = {
  key: string;
  name: string;
  position: Point3AuInput;
  radiusKm?: number;
  arrivalRadiusKm?: number;
};

export type Waypoint = {
  id: string;
  label?: string;
  point: Point3AuInput;
  bodyKey?: string;
  arrivalRadiusKm?: number;
};

export type MeasurementPoint = {
  kind: "body" | "map" | "waypoint";
  point: Point3AuInput;
  id?: string;
  label?: string;
  bodyKey?: string;
};

export type JourneySummaryState = {
  routeKey?: string;
  waypointCount: number;
  currentWaypointIndex: number;
  completedWaypointCount: number;
  elapsedSeconds: number;
  distanceTraveledKm: number;
  maxSpeedKmS: number;
  closestApproachKm: number | null;
  lastPoint: Point3Au | null;
  arrived: boolean;
};

export type NavigationPointReference = Point3AuInput | BodyLike | Waypoint | MeasurementPoint;

export type NearestBodyResult<TBody extends BodyLike = BodyLike> = {
  body: TBody;
  distanceAu: number;
  distanceKm: number;
};

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

export type Velocity3AuPerSecond = {
  xAuPerSecond: number;
  yAuPerSecond: number;
  zAuPerSecond?: number;
};

export type HeadingFeedbackInput = {
  from: NavigationPointReference;
  to: NavigationPointReference;
  headingRad: number;
  velocityAuPerSecond?: Velocity3AuPerSecond;
  warpEnabled?: boolean;
  warpMultiplier?: number;
  auKm?: number;
  alignedThresholdDeg?: number;
  correctionThresholdDeg?: number;
  minClosingSpeedKmPerSecond?: number;
};

export type HeadingFeedbackResult = {
  distanceAu: number;
  distanceKm: number;
  targetBearingRad: number;
  signedHeadingErrorRad: number;
  headingErrorDeg: number;
  turnDirection: "left" | "right" | "none";
  alignment: "aligned" | "course_correction" | "wide_error" | "opposite";
  closingSpeedKmPerSecond: number | null;
  etaSeconds: number | null;
  status: "arrived" | "holding_course" | "course_correcting" | "turn_to_target" | "drifting_away" | "not_closing";
  warp: {
    enabled: boolean;
    multiplier: number;
    label: string;
    courseStable: boolean;
    recommendation: "hold_course" | "course_correcting" | "disable_warp_until_aligned" | "no_velocity";
  };
};

export type JourneySummarySample = {
  point: NavigationPointReference;
  target?: NavigationPointReference;
  speedKmPerSecond?: number;
  deltaSeconds?: number;
  arrived?: boolean;
  currentWaypointIndex?: number;
  completedWaypointCount?: number;
};

export type JourneySummaryOptions = {
  auKm?: number;
  waypoints?: readonly Waypoint[];
  defaultArrivalRadiusKm?: number;
};

export function distanceAu(a: NavigationPointReference, b: NavigationPointReference): number {
  const start = pointFrom(a);
  const end = pointFrom(b);
  return Math.hypot(end.xAu - start.xAu, end.yAu - start.yAu, end.zAu - start.zAu);
}

export function distanceKm(a: NavigationPointReference, b: NavigationPointReference, auKm = DEFAULT_AU_KM): number {
  return distanceAu(a, b) * auKm;
}

export function progressAlongSegment(
  start: NavigationPointReference,
  end: NavigationPointReference,
  current: NavigationPointReference,
  options: { clampToSegment?: boolean } = {}
): number {
  const origin = pointFrom(start);
  const target = pointFrom(end);
  const point = pointFrom(current);

  const vx = target.xAu - origin.xAu;
  const vy = target.yAu - origin.yAu;
  const vz = target.zAu - origin.zAu;
  const wx = point.xAu - origin.xAu;
  const wy = point.yAu - origin.yAu;
  const wz = point.zAu - origin.zAu;
  const segmentLengthSquared = vx * vx + vy * vy + vz * vz;

  if (segmentLengthSquared === 0) return 0;

  const progress = (wx * vx + wy * vy + wz * vz) / segmentLengthSquared;
  return options.clampToSegment === false ? progress : clamp(progress, 0, 1);
}

export function polylineTotalDistanceKm(points: readonly NavigationPointReference[], auKm = DEFAULT_AU_KM): number {
  let totalKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalKm += distanceKm(points[index - 1], points[index], auKm);
  }
  return totalKm;
}

export function nearestBody<TBody extends BodyLike>(
  point: NavigationPointReference,
  bodies: readonly TBody[],
  options: { auKm?: number; maxDistanceKm?: number } = {}
): NearestBodyResult<TBody> | null {
  const auKm = options.auKm ?? DEFAULT_AU_KM;
  let nearest: NearestBodyResult<TBody> | null = null;

  for (const body of bodies) {
    const candidateDistanceAu = distanceAu(point, body);
    const candidateDistanceKm = candidateDistanceAu * auKm;
    if (options.maxDistanceKm !== undefined && candidateDistanceKm > options.maxDistanceKm) {
      continue;
    }

    if (!nearest || candidateDistanceKm < nearest.distanceKm) {
      nearest = {
        body,
        distanceAu: candidateDistanceAu,
        distanceKm: candidateDistanceKm
      };
    }
  }

  return nearest;
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
      displayValue: formatRatio(distanceKmValue / auKm),
      description: `That is ${formatRatio(distanceKmValue / auKm)} AU.`
    },
    {
      key: "earth_moon_distances",
      label: "Earth-Moon distances",
      value: distanceKmValue / EARTH_MOON_AVERAGE_KM,
      unit: "lunar distances",
      displayValue: formatRatio(distanceKmValue / EARTH_MOON_AVERAGE_KM),
      description: `That is ${formatRatio(distanceKmValue / EARTH_MOON_AVERAGE_KM)} average Earth-Moon distances.`
    },
    {
      key: "earth_circumferences",
      label: "Earth circumferences",
      value: distanceKmValue / EARTH_EQUATORIAL_CIRCUMFERENCE_KM,
      unit: "Earth circumferences",
      displayValue: formatRatio(distanceKmValue / EARTH_EQUATORIAL_CIRCUMFERENCE_KM),
      description: `That is ${formatRatio(distanceKmValue / EARTH_EQUATORIAL_CIRCUMFERENCE_KM)} trips around Earth's equator.`
    }
  ];

  if (options.includeMissionComparisons ?? true) {
    comparisons.push(
      {
        key: "mars_close_approaches",
        label: "Close Mars approaches",
        value: distanceKmValue / MARS_CLOSE_APPROACH_KM,
        unit: "close Mars approaches",
        displayValue: formatRatio(distanceKmValue / MARS_CLOSE_APPROACH_KM),
        description: `That is ${formatRatio(distanceKmValue / MARS_CLOSE_APPROACH_KM)} close Earth-Mars approach distances.`
      },
      {
        key: "voyager_one_days",
        label: "Voyager 1 travel days",
        value: distanceKmValue / VOYAGER_ONE_DAILY_DISTANCE_KM,
        unit: "days at 17 km/s",
        displayValue: formatRatio(distanceKmValue / VOYAGER_ONE_DAILY_DISTANCE_KM),
        description: `At 17 km/s, this distance takes about ${formatRatio(distanceKmValue / VOYAGER_ONE_DAILY_DISTANCE_KM)} days.`
      }
    );
  }

  return comparisons;
}

export function headingFeedback(input: HeadingFeedbackInput): HeadingFeedbackResult {
  const from = pointFrom(input.from);
  const to = pointFrom(input.to);
  const auKm = input.auKm ?? DEFAULT_AU_KM;
  const alignedThresholdDeg = input.alignedThresholdDeg ?? 5;
  const correctionThresholdDeg = input.correctionThresholdDeg ?? 25;
  const minClosingSpeedKmPerSecond = input.minClosingSpeedKmPerSecond ?? 0.001;
  const dx = to.xAu - from.xAu;
  const dy = to.yAu - from.yAu;
  const dz = to.zAu - from.zAu;
  const distanceAuValue = Math.hypot(dx, dy, dz);
  const distanceKmValue = distanceAuValue * auKm;
  const targetBearingRad = distanceAuValue === 0 ? input.headingRad : Math.atan2(dy, dx);
  const signedHeadingErrorRad = normalizeAngle(targetBearingRad - input.headingRad);
  const headingErrorDeg = Math.abs(radToDeg(signedHeadingErrorRad));
  const closingSpeedKmPerSecond = input.velocityAuPerSecond
    ? closingSpeed(input.velocityAuPerSecond, { xAu: dx, yAu: dy, zAu: dz }, distanceAuValue) * auKm
    : null;
  const etaSeconds =
    closingSpeedKmPerSecond !== null && closingSpeedKmPerSecond > minClosingSpeedKmPerSecond
      ? distanceKmValue / closingSpeedKmPerSecond
      : null;
  const alignment = alignmentForError(headingErrorDeg, alignedThresholdDeg, correctionThresholdDeg);
  const status = headingStatus(distanceAuValue, headingErrorDeg, alignedThresholdDeg, correctionThresholdDeg, closingSpeedKmPerSecond, minClosingSpeedKmPerSecond);
  const warpEnabled = input.warpEnabled ?? false;
  const warpMultiplier = input.warpMultiplier ?? (warpEnabled ? 250 : 1);
  const courseStable = status === "holding_course" || status === "arrived";

  return {
    distanceAu: distanceAuValue,
    distanceKm: distanceKmValue,
    targetBearingRad,
    signedHeadingErrorRad,
    headingErrorDeg,
    turnDirection: turnDirectionForError(signedHeadingErrorRad, alignedThresholdDeg),
    alignment,
    closingSpeedKmPerSecond,
    etaSeconds,
    status,
    warp: {
      enabled: warpEnabled,
      multiplier: warpMultiplier,
      label: warpEnabled ? `${formatRatio(warpMultiplier)}x` : "off",
      courseStable,
      recommendation: warpRecommendation(warpEnabled, courseStable, closingSpeedKmPerSecond)
    }
  };
}

export function createJourneySummaryState(options: {
  routeKey?: string;
  waypointCount?: number;
  initialPoint?: NavigationPointReference;
  initialTarget?: NavigationPointReference;
  initialSpeedKmPerSecond?: number;
  auKm?: number;
} = {}): JourneySummaryState {
  const initialPoint = options.initialPoint ? pointFrom(options.initialPoint) : null;
  const closestApproachKm =
    options.initialPoint && options.initialTarget
      ? distanceKm(options.initialPoint, options.initialTarget, options.auKm ?? DEFAULT_AU_KM)
      : null;

  return {
    routeKey: options.routeKey,
    waypointCount: options.waypointCount ?? 0,
    currentWaypointIndex: 0,
    completedWaypointCount: 0,
    elapsedSeconds: 0,
    distanceTraveledKm: 0,
    maxSpeedKmS: finitePositive(options.initialSpeedKmPerSecond) ?? 0,
    closestApproachKm,
    lastPoint: initialPoint,
    arrived: false
  };
}

export function accumulateJourneySummary(
  state: JourneySummaryState,
  sample: JourneySummarySample,
  options: JourneySummaryOptions = {}
): JourneySummaryState {
  const auKm = options.auKm ?? DEFAULT_AU_KM;
  const point = pointFrom(sample.point);
  const deltaSeconds = finitePositive(sample.deltaSeconds) ?? 0;
  const segmentKm = state.lastPoint ? distanceKm(state.lastPoint, point, auKm) : 0;
  const sampleSpeedKmPerSecond = finitePositive(sample.speedKmPerSecond) ?? (deltaSeconds > 0 ? segmentKm / deltaSeconds : 0);
  const waypointCount = options.waypoints?.length ?? state.waypointCount;
  const waypointProgress = advanceWaypointProgress(
    point,
    options.waypoints,
    sample.currentWaypointIndex ?? state.currentWaypointIndex,
    options.defaultArrivalRadiusKm,
    auKm
  );
  const currentWaypointIndex = clampInteger(waypointProgress.currentWaypointIndex, 0, waypointCount);
  const completedWaypointCount = clampInteger(
    Math.max(sample.completedWaypointCount ?? state.completedWaypointCount, waypointProgress.completedWaypointCount),
    0,
    waypointCount
  );
  const target = sample.target ?? options.waypoints?.[currentWaypointIndex] ?? null;
  const targetDistanceKm = target ? distanceKm(point, target, auKm) : null;
  const closestApproachKm =
    targetDistanceKm === null
      ? state.closestApproachKm
      : state.closestApproachKm === null
        ? targetDistanceKm
        : Math.min(state.closestApproachKm, targetDistanceKm);

  return {
    ...state,
    waypointCount,
    currentWaypointIndex,
    completedWaypointCount,
    elapsedSeconds: state.elapsedSeconds + deltaSeconds,
    distanceTraveledKm: state.distanceTraveledKm + segmentKm,
    maxSpeedKmS: Math.max(state.maxSpeedKmS, sampleSpeedKmPerSecond),
    closestApproachKm,
    lastPoint: point,
    arrived: sample.arrived ?? (options.waypoints ? currentWaypointIndex >= options.waypoints.length : state.arrived)
  };
}

function pointFrom(reference: NavigationPointReference): Point3Au {
  if ("point" in reference) return normalizePoint(reference.point);
  if ("position" in reference) return normalizePoint(reference.position);
  return normalizePoint(reference);
}

function normalizePoint(point: Point3AuInput): Point3Au {
  if ("x_au" in point) {
    return {
      xAu: point.x_au,
      yAu: point.y_au,
      zAu: point.z_au
    };
  }

  return point;
}

function closingSpeed(velocity: Velocity3AuPerSecond, targetVector: Point3Au, targetDistanceAu: number): number {
  if (targetDistanceAu === 0) return 0;
  return (
    (velocity.xAuPerSecond * targetVector.xAu +
      velocity.yAuPerSecond * targetVector.yAu +
      (velocity.zAuPerSecond ?? 0) * targetVector.zAu) /
    targetDistanceAu
  );
}

function alignmentForError(
  headingErrorDeg: number,
  alignedThresholdDeg: number,
  correctionThresholdDeg: number
): HeadingFeedbackResult["alignment"] {
  if (headingErrorDeg <= alignedThresholdDeg) return "aligned";
  if (headingErrorDeg <= correctionThresholdDeg) return "course_correction";
  if (headingErrorDeg >= 150) return "opposite";
  return "wide_error";
}

function headingStatus(
  distanceAuValue: number,
  headingErrorDeg: number,
  alignedThresholdDeg: number,
  correctionThresholdDeg: number,
  closingSpeedKmPerSecond: number | null,
  minClosingSpeedKmPerSecond: number
): HeadingFeedbackResult["status"] {
  if (distanceAuValue === 0) return "arrived";
  if (closingSpeedKmPerSecond !== null && closingSpeedKmPerSecond < -minClosingSpeedKmPerSecond) return "drifting_away";
  if (closingSpeedKmPerSecond !== null && Math.abs(closingSpeedKmPerSecond) <= minClosingSpeedKmPerSecond) return "not_closing";
  if (headingErrorDeg <= alignedThresholdDeg) return "holding_course";
  if (headingErrorDeg <= correctionThresholdDeg) return "course_correcting";
  return "turn_to_target";
}

function turnDirectionForError(signedHeadingErrorRad: number, alignedThresholdDeg: number): HeadingFeedbackResult["turnDirection"] {
  if (Math.abs(radToDeg(signedHeadingErrorRad)) <= alignedThresholdDeg) return "none";
  return signedHeadingErrorRad > 0 ? "left" : "right";
}

function warpRecommendation(
  warpEnabled: boolean,
  courseStable: boolean,
  closingSpeedKmPerSecond: number | null
): HeadingFeedbackResult["warp"]["recommendation"] {
  if (closingSpeedKmPerSecond === null) return "no_velocity";
  if (courseStable) return "hold_course";
  if (warpEnabled) return "disable_warp_until_aligned";
  return "course_correcting";
}

function advanceWaypointProgress(
  point: Point3Au,
  waypoints: readonly Waypoint[] | undefined,
  startingIndex: number,
  defaultArrivalRadiusKm: number | undefined,
  auKm: number
): { currentWaypointIndex: number; completedWaypointCount: number } {
  if (!waypoints || waypoints.length === 0) {
    return { currentWaypointIndex: startingIndex, completedWaypointCount: startingIndex };
  }

  let currentWaypointIndex = clampInteger(startingIndex, 0, waypoints.length);
  while (currentWaypointIndex < waypoints.length) {
    const waypoint = waypoints[currentWaypointIndex];
    const arrivalRadiusKm = waypoint.arrivalRadiusKm ?? defaultArrivalRadiusKm ?? 0;
    if (distanceKm(point, waypoint, auKm) > arrivalRadiusKm) break;
    currentWaypointIndex += 1;
  }

  return {
    currentWaypointIndex,
    completedWaypointCount: currentWaypointIndex
  };
}

function finitePositive(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

function normalizeAngle(radians: number): number {
  let angle = radians;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unavailable";
  if (Math.abs(seconds) < 90) return `${seconds.toFixed(1)} s`;
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 90) return `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  if (Math.abs(hours) < 48) return `${hours.toFixed(2)} h`;
  return `${(hours / 24).toFixed(2)} d`;
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "unavailable";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(3);
  return value.toExponential(2);
}
