import { AU_PER_LIGHT_YEAR, lightYearsToAu } from "./galacticModel";

// Procedural context layers for scales where real catalogs are necessarily sparse,
// incomplete, or too large to ship as selectable browser objects. These are
// deliberately not selectable catalog objects; they are visual scale scaffolding
// behind real catalog points/search results.
export type UniversePoint = {
  key: string;
  label: string;
  xAu: number;
  yAu: number;
  radiusLy: number;
  color: string;
  kind: "galaxy" | "satellite" | "cluster" | "supercluster" | "quasar-field";
  note?: string;
};

export type UniverseRing = {
  key: string;
  label: string;
  xAu: number;
  yAu: number;
  radiusLy: number;
  color: string;
};

export type UniverseFilament = {
  key: string;
  label: string;
  points: { xAu: number; yAu: number }[];
  color: string;
};

export type UniverseDensityRegion = {
  key: string;
  label: string;
  xAu: number;
  yAu: number;
  radiusLy: number;
  color: string;
  intensity: number;
  kind: "wall" | "cluster-core" | "void" | "quasar-haze";
};

export type UniverseModel = {
  bounds: { minXAu: number; maxXAu: number; minYAu: number; maxYAu: number };
  points: UniversePoint[];
  rings: UniverseRing[];
  filaments: UniverseFilament[];
  densityRegions?: UniverseDensityRegion[];
};

function pointLy(key: string, label: string, xLy: number, yLy: number, radiusLy: number, color: string, kind: UniversePoint["kind"], note?: string): UniversePoint {
  return { key, label, xAu: lightYearsToAu(xLy), yAu: lightYearsToAu(yLy), radiusLy, color, kind, note };
}

function ringLy(key: string, label: string, xLy: number, yLy: number, radiusLy: number, color: string): UniverseRing {
  return { key, label, xAu: lightYearsToAu(xLy), yAu: lightYearsToAu(yLy), radiusLy, color };
}

function filamentLy(key: string, label: string, points: [number, number][], color: string): UniverseFilament {
  return { key, label, points: points.map(([xLy, yLy]) => ({ xAu: lightYearsToAu(xLy), yAu: lightYearsToAu(yLy) })), color };
}

function densityLy(key: string, label: string, xLy: number, yLy: number, radiusLy: number, color: string, intensity: number, kind: UniverseDensityRegion["kind"]): UniverseDensityRegion {
  return { key, label, xAu: lightYearsToAu(xLy), yAu: lightYearsToAu(yLy), radiusLy, color, intensity, kind };
}

export const LOCAL_GROUP_MODEL: UniverseModel = {
  bounds: {
    minXAu: -3_400_000 * AU_PER_LIGHT_YEAR,
    maxXAu: 3_200_000 * AU_PER_LIGHT_YEAR,
    minYAu: -2_650_000 * AU_PER_LIGHT_YEAR,
    maxYAu: 2_900_000 * AU_PER_LIGHT_YEAR
  },
  rings: [
    ringLy("local-group-radius", "Local Group gravitational neighborhood", 0, 0, 5_000_000, "rgba(128, 194, 255, 0.34)"),
    ringLy("milky-way-halo", "Milky Way dark-matter halo", 0, 0, 1_000_000, "rgba(239, 218, 172, 0.32)"),
    ringLy("m31-halo", "Andromeda halo", 2_540_000, 520_000, 1_100_000, "rgba(179, 213, 255, 0.3)")
  ],
  points: [
    pointLy("milky-way", "Milky Way", 0, 0, 75_000, "rgba(248, 220, 150, 0.92)", "galaxy"),
    pointLy("andromeda", "Andromeda / M31", 2_540_000, 520_000, 110_000, "rgba(184, 216, 255, 0.9)", "galaxy"),
    pointLy("triangulum", "Triangulum / M33", 2_730_000, -720_000, 60_000, "rgba(168, 211, 255, 0.78)", "galaxy"),
    pointLy("lmc", "Large Magellanic Cloud", -160_000, -105_000, 22_000, "rgba(160, 205, 255, 0.78)", "satellite"),
    pointLy("smc", "Small Magellanic Cloud", -200_000, -150_000, 13_000, "rgba(145, 194, 255, 0.7)", "satellite"),
    pointLy("m32", "M32", 2_500_000, 650_000, 8_000, "rgba(202, 226, 255, 0.65)", "satellite"),
    pointLy("m110", "M110", 2_620_000, 700_000, 15_000, "rgba(202, 226, 255, 0.62)", "satellite")
  ],
  filaments: [
    filamentLy("local-group-axis", "Milky Way–Andromeda flow", [[-300_000, -80_000], [0, 0], [1_100_000, 250_000], [2_540_000, 520_000], [2_900_000, 250_000]], "rgba(137, 194, 255, 0.22)")
  ],
  densityRegions: [
    densityLy("local-group-haze", "Local Group galaxy density", 1_150_000, 165_000, 2_900_000, "rgba(137, 194, 255, 0.13)", 0.58, "cluster-core"),
    densityLy("local-void-edge", "Local Void boundary", -2_400_000, 1_650_000, 1_900_000, "rgba(82, 118, 154, 0.08)", 0.34, "void")
  ]
};

export const COSMIC_WEB_MODEL: UniverseModel = {
  bounds: {
    minXAu: -320_000_000 * AU_PER_LIGHT_YEAR,
    maxXAu: 360_000_000 * AU_PER_LIGHT_YEAR,
    minYAu: -260_000_000 * AU_PER_LIGHT_YEAR,
    maxYAu: 280_000_000 * AU_PER_LIGHT_YEAR
  },
  rings: [
    ringLy("local-volume", "Local Volume", 0, 0, 35_000_000, "rgba(154, 205, 255, 0.22)"),
    ringLy("local-supercluster", "Local Supercluster scale", 0, 0, 110_000_000, "rgba(169, 140, 255, 0.18)"),
    ringLy("deep-survey-shell", "Deep redshift-survey shell", 0, 0, 300_000_000, "rgba(255, 190, 128, 0.13)")
  ],
  points: [
    pointLy("virgo", "Virgo Cluster", 54_000_000, 18_000_000, 5_000_000, "rgba(155, 214, 255, 0.72)", "cluster"),
    pointLy("fornax", "Fornax Cluster", -62_000_000, -28_000_000, 3_500_000, "rgba(138, 205, 255, 0.55)", "cluster"),
    pointLy("coma", "Coma Cluster", 315_000_000, 92_000_000, 10_000_000, "rgba(203, 177, 255, 0.62)", "cluster"),
    pointLy("great-attractor", "Great Attractor region", -150_000_000, -70_000_000, 24_000_000, "rgba(255, 184, 117, 0.58)", "supercluster"),
    pointLy("perseus-pisces", "Perseus–Pisces filament", 240_000_000, -120_000_000, 18_000_000, "rgba(179, 211, 255, 0.54)", "supercluster"),
    pointLy("quasar-field-north", "Distant quasar field", -280_000_000, 185_000_000, 34_000_000, "rgba(255, 226, 147, 0.4)", "quasar-field"),
    pointLy("quasar-field-south", "Distant quasar field", 180_000_000, -220_000_000, 42_000_000, "rgba(255, 226, 147, 0.36)", "quasar-field")
  ],
  filaments: [
    filamentLy("virgo-laniakea", "Local Sheet into Virgo / Laniakea", [[-58_000_000, -30_000_000], [0, 0], [54_000_000, 18_000_000], [120_000_000, -22_000_000], [180_000_000, -60_000_000]], "rgba(118, 197, 255, 0.2)"),
    filamentLy("great-attractor-flow", "Great Attractor flow", [[-210_000_000, -120_000_000], [-150_000_000, -70_000_000], [-80_000_000, -25_000_000], [0, 0], [54_000_000, 18_000_000]], "rgba(255, 175, 107, 0.18)"),
    filamentLy("coma-wall", "Coma / Great Wall context", [[130_000_000, 105_000_000], [210_000_000, 130_000_000], [315_000_000, 92_000_000], [350_000_000, 20_000_000]], "rgba(194, 168, 255, 0.18)"),
    filamentLy("perseus-pisces-chain", "Perseus–Pisces chain", [[70_000_000, -155_000_000], [150_000_000, -145_000_000], [240_000_000, -120_000_000], [320_000_000, -85_000_000]], "rgba(154, 205, 255, 0.17)")
  ],
  densityRegions: [
    densityLy("virgo-density-haze", "Virgo cluster density", 54_000_000, 18_000_000, 32_000_000, "rgba(118, 197, 255, 0.16)", 0.72, "cluster-core"),
    densityLy("great-wall-haze", "Great Wall density ridge", 240_000_000, 90_000_000, 120_000_000, "rgba(194, 168, 255, 0.12)", 0.68, "wall"),
    densityLy("perseus-density-haze", "Perseus–Pisces density ridge", 210_000_000, -125_000_000, 95_000_000, "rgba(154, 205, 255, 0.11)", 0.58, "wall"),
    densityLy("quasar-north-haze", "Distant quasar density field", -280_000_000, 185_000_000, 105_000_000, "rgba(255, 226, 147, 0.12)", 0.5, "quasar-haze"),
    densityLy("quasar-south-haze", "Distant quasar density field", 180_000_000, -220_000_000, 120_000_000, "rgba(255, 226, 147, 0.1)", 0.48, "quasar-haze"),
    densityLy("bootes-void-context", "Boötes-like void context", -105_000_000, 145_000_000, 82_000_000, "rgba(84, 105, 145, 0.065)", 0.42, "void")
  ]
};
