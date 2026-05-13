export type GalacticModelPoint = {
  xAu: number;
  yAu: number;
  zAu: number;
};

export type GalacticModelFeatureKind = "disk" | "ring" | "arm" | "bar";

export type GalacticModelFeature = {
  key: string;
  label: string;
  kind: GalacticModelFeatureKind;
  points: GalacticModelPoint[];
  color: string;
  lineWidth: number;
  fill?: string;
  dash?: readonly number[];
  labelPoint?: GalacticModelPoint;
};

export type GalacticModelMarker = {
  key: string;
  label: string;
  detail: string;
  point: GalacticModelPoint;
  color: string;
};

export type GalacticModelCloud = {
  key: string;
  point: GalacticModelPoint;
  radiusLy: number;
  color: string;
  alpha: number;
};

export type GalacticModel = {
  features: GalacticModelFeature[];
  clouds: GalacticModelCloud[];
  markers: GalacticModelMarker[];
  bounds: {
    minXAu: number;
    maxXAu: number;
    minYAu: number;
    maxYAu: number;
  };
};

export const AU_PER_LIGHT_YEAR = 63_241.07708426628;
export const MILKY_WAY_RADIUS_LY = 52_000;
export const GALACTIC_CENTER_DISTANCE_LY = 26_700;

const J2000_OBLIQUITY_RAD = degToRad(23.4392911111);

// Standard J2000 equatorial-to-galactic rotation matrix. The transpose maps
// Galactic lon/lat vectors back into the same equatorial frame used by catalogs.
const EQUATORIAL_TO_GALACTIC = [
  [-0.0548755604162154, -0.873437090234885, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]
] as const;

const SPIRAL_ARM_SPECS = [
  { key: "scutum-centaurus", label: "Scutum-Centaurus Arm", startRadiusLy: 13_000, endRadiusLy: 24_000, startAngleDeg: -28, endAngleDeg: 178, color: "rgba(236, 183, 89, 0.58)", lineWidth: 2.5 },
  { key: "sagittarius-carina", label: "Sagittarius-Carina Arm", startRadiusLy: 19_000, endRadiusLy: 29_000, startAngleDeg: 40, endAngleDeg: 232, color: "rgba(189, 101, 73, 0.58)", lineWidth: 2.2 },
  { key: "local-arm", label: "Local Arm", startRadiusLy: 25_100, endRadiusLy: 28_800, startAngleDeg: 145, endAngleDeg: 228, color: "rgba(130, 203, 179, 0.74)", lineWidth: 3 },
  { key: "perseus", label: "Perseus Arm", startRadiusLy: 30_500, endRadiusLy: 39_500, startAngleDeg: 112, endAngleDeg: 292, color: "rgba(219, 204, 164, 0.54)", lineWidth: 2.2 },
  { key: "outer", label: "Outer Arm", startRadiusLy: 39_000, endRadiusLy: 48_000, startAngleDeg: 178, endAngleDeg: 330, color: "rgba(180, 196, 186, 0.42)", lineWidth: 1.7 }
] as const;

export const MILKY_WAY_MODEL: GalacticModel = buildMilkyWayModel();

export function lightYearsToAu(valueLy: number) {
  return valueLy * AU_PER_LIGHT_YEAR;
}

function buildMilkyWayModel(): GalacticModel {
  const features: GalacticModelFeature[] = [
    {
      key: "milky-way-disk",
      label: "Milky Way disk",
      kind: "disk",
      points: galacticCirclePoints(MILKY_WAY_RADIUS_LY, 360),
      color: "rgba(213, 190, 139, 0.4)",
      fill: "rgba(213, 190, 139, 0.055)",
      lineWidth: 1.2
    },
    {
      key: "inner-reference-ring",
      label: "Inner disk",
      kind: "ring",
      points: galacticCirclePoints(16_000, 240),
      color: "rgba(239, 233, 213, 0.18)",
      lineWidth: 0.8,
      dash: [4, 9]
    },
    {
      key: "solar-reference-ring",
      label: "Solar circle",
      kind: "ring",
      points: galacticCirclePoints(GALACTIC_CENTER_DISTANCE_LY, 280),
      color: "rgba(130, 203, 179, 0.2)",
      lineWidth: 0.9,
      dash: [6, 10]
    },
    {
      key: "galactic-bar",
      label: "Central bar",
      kind: "bar",
      points: galacticBarPoints(14_500, 27),
      color: "rgba(236, 183, 89, 0.46)",
      lineWidth: 5.5,
      labelPoint: galactocentricPolarToEclipticAu(7_000, degToRad(27))
    },
    ...SPIRAL_ARM_SPECS.map((spec) => spiralArm(spec))
  ];

  const clouds = [
    ...SPIRAL_ARM_SPECS.flatMap((spec) => dustClouds(spec, 68)),
    coreDustLane()
  ];

  const markers = [
    {
      key: "galactic-center",
      label: "Galactic center",
      detail: "Sagittarius A* direction",
      point: galactocentricPolarToEclipticAu(0, 0),
      color: "rgba(236, 183, 89, 0.94)"
    }
  ];

  return {
    features,
    clouds,
    markers,
    bounds: boundsForPoints([
      ...features.flatMap((feature) => feature.points),
      ...clouds.map((cloud) => cloud.point),
      ...markers.map((marker) => marker.point)
    ])
  };
}

function galacticCirclePoints(radiusLy: number, samples: number) {
  const points: GalacticModelPoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    points.push(galactocentricPolarToEclipticAu(radiusLy, (index / samples) * Math.PI * 2));
  }
  return points;
}

function galacticBarPoints(radiusLy: number, angleDeg: number) {
  const angle = degToRad(angleDeg);
  return [galactocentricPolarToEclipticAu(radiusLy, angle), galactocentricPolarToEclipticAu(radiusLy, angle + Math.PI)];
}

function spiralArm(spec: (typeof SPIRAL_ARM_SPECS)[number]): GalacticModelFeature {
  const samples = 112;
  const points: GalacticModelPoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    const radiusLy = lerp(spec.startRadiusLy, spec.endRadiusLy, progress);
    const angle = degToRad(lerp(spec.startAngleDeg, spec.endAngleDeg, progress));
    points.push(galactocentricPolarToEclipticAu(radiusLy, angle));
  }
  return {
    key: spec.key,
    label: spec.label,
    kind: "arm",
    points,
    color: spec.color,
    lineWidth: spec.lineWidth,
    labelPoint: points[Math.floor(points.length * 0.54)]
  };
}

function dustClouds(spec: (typeof SPIRAL_ARM_SPECS)[number], count: number): GalacticModelCloud[] {
  const clouds: GalacticModelCloud[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = (index + seedNoise(index, spec.key.length + 59)) / count;
    const radialJitter = -1_100 + (seedNoise(index, spec.key.length + 61) - 0.5) * 2_200;
    const angleJitter = (seedNoise(index, spec.key.length + 67) - 0.5) * 8;
    const radiusLy = lerp(spec.startRadiusLy, spec.endRadiusLy, progress) + radialJitter;
    const angle = degToRad(lerp(spec.startAngleDeg, spec.endAngleDeg, progress) + angleJitter);
    clouds.push({
      key: `${spec.key}-dust-${index}`,
      point: galactocentricPolarToEclipticAu(radiusLy, angle),
      radiusLy: 700 + seedNoise(index, spec.key.length + 71) * 3_100,
      color: "6, 8, 7",
      alpha: 0.09 + seedNoise(index, spec.key.length + 73) * 0.13
    });
  }
  return clouds;
}

function coreDustLane(): GalacticModelCloud {
  return {
    key: "core-dust-lane",
    point: galactocentricPolarToEclipticAu(2_800, degToRad(32)),
    radiusLy: 4_200,
    color: "6, 8, 7",
    alpha: 0.22
  };
}

function galactocentricPolarToEclipticAu(radiusLy: number, thetaRad: number): GalacticModelPoint {
  const xLy = GALACTIC_CENTER_DISTANCE_LY + radiusLy * Math.cos(thetaRad);
  const yLy = radiusLy * Math.sin(thetaRad);
  return galacticVectorToEclipticAu(xLy, yLy, 0);
}

function galacticVectorToEclipticAu(xLy: number, yLy: number, zLy: number): GalacticModelPoint {
  const equatorial = galacticToEquatorial([xLy, yLy, zLy]);
  const ecliptic = equatorialToEcliptic(equatorial);
  return {
    xAu: ecliptic[0] * AU_PER_LIGHT_YEAR,
    yAu: ecliptic[1] * AU_PER_LIGHT_YEAR,
    zAu: ecliptic[2] * AU_PER_LIGHT_YEAR
  };
}

function galacticToEquatorial(vector: readonly [number, number, number]): [number, number, number] {
  return [
    EQUATORIAL_TO_GALACTIC[0][0] * vector[0] + EQUATORIAL_TO_GALACTIC[1][0] * vector[1] + EQUATORIAL_TO_GALACTIC[2][0] * vector[2],
    EQUATORIAL_TO_GALACTIC[0][1] * vector[0] + EQUATORIAL_TO_GALACTIC[1][1] * vector[1] + EQUATORIAL_TO_GALACTIC[2][1] * vector[2],
    EQUATORIAL_TO_GALACTIC[0][2] * vector[0] + EQUATORIAL_TO_GALACTIC[1][2] * vector[1] + EQUATORIAL_TO_GALACTIC[2][2] * vector[2]
  ];
}

function equatorialToEcliptic(vector: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = vector;
  const cosObliquity = Math.cos(J2000_OBLIQUITY_RAD);
  const sinObliquity = Math.sin(J2000_OBLIQUITY_RAD);
  return [x, cosObliquity * y + sinObliquity * z, -sinObliquity * y + cosObliquity * z];
}

function boundsForPoints(points: GalacticModelPoint[]) {
  return points.reduce(
    (bounds, point) => ({
      minXAu: Math.min(bounds.minXAu, point.xAu),
      maxXAu: Math.max(bounds.maxXAu, point.xAu),
      minYAu: Math.min(bounds.minYAu, point.yAu),
      maxYAu: Math.max(bounds.maxYAu, point.yAu)
    }),
    {
      minXAu: Number.POSITIVE_INFINITY,
      maxXAu: Number.NEGATIVE_INFINITY,
      minYAu: Number.POSITIVE_INFINITY,
      maxYAu: Number.NEGATIVE_INFINITY
    }
  );
}

function seedNoise(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}
