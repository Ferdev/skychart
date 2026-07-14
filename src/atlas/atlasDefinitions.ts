import type { BodyFilterDefinition, ExploreDomainDefinition, UniverseShell, ZoomPreset } from "./contracts";
import { classifyBody } from "../destinationPicker";
import { isSolarSystemBody } from "../rendering/atlasVisibilityModel";
import type { BodyFilter } from "../viewState";

export const STARTUP_EPHEMERIS_GROUPS = [
  "core", "mars_moons", "jupiter_major_moons", "saturn_major_moons", "nearby_exoplanet_systems", "messier_deep_sky",
] as const;

export const STARTUP_CATALOG_GROUPS = [
  "core", "mars_moons", "jupiter_major_moons", "saturn_major_moons", "nearby_exoplanet_systems", "messier_deep_sky",
];

export const FEATURED_KEYS = ["earth", "moon", "mars", "jupiter", "saturn", "proxima-cen", "m31", "m42"];

export const BODY_FILTERS: BodyFilterDefinition[] = [
  { key: "all", labelKey: "filters.all" },
  { key: "solar_system", labelKey: "filters.solarSystem", types: ["star", "planet", "moon", "dwarf_planet"], groups: ["core", "mars_moons", "jupiter_major_moons", "saturn_major_moons"] },
  { key: "planet", labelKey: "filters.planets", types: ["planet"] },
  { key: "moon", labelKey: "filters.moons", types: ["moon"], groups: ["core", "mars_moons", "jupiter_major_moons", "saturn_major_moons"] },
  { key: "star", labelKey: "filters.stars", types: ["star"] },
  { key: "bright_star", labelKey: "filters.bright", types: ["star"], groups: ["bright_stars"] },
  { key: "gaia_star", labelKey: "filters.gaia", types: ["star"], groups: ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"] },
  { key: "exoplanet_system", labelKey: "filters.exoplanets", groups: ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"] },
  { key: "dwarf_planet", labelKey: "filters.dwarf", types: ["dwarf_planet"], groups: ["core", "jpl_small_bodies"] },
  { key: "small_body", labelKey: "filters.smallBodies", types: ["asteroid", "comet", "small_body"], groups: ["jpl_small_bodies"] },
  { key: "asteroid", labelKey: "filters.asteroids", types: ["asteroid"] },
  { key: "comet", labelKey: "filters.comets", types: ["comet"] },
  { key: "deep_sky", labelKey: "filters.deepSky", types: ["galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster"], groups: ["messier_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "bass_dr2_black_holes", "curated_extragalactic_survey", "desi_dr1_galaxies", "desi_dr1_quasars", "quaia_g20_quasars"] },
  { key: "galaxy", labelKey: "filters.galaxies", types: ["galaxy"] },
  { key: "quasar", labelKey: "filters.quasars", types: ["quasar"] },
  { key: "active_galaxy", labelKey: "filters.agn", types: ["active_galaxy"] },
  { key: "black_hole", labelKey: "filters.blackHoles", types: ["black_hole"] },
  { key: "pulsar", labelKey: "filters.pulsars", types: ["pulsar"] },
  { key: "nebula", labelKey: "filters.nebulae", types: ["nebula"] },
  { key: "star_cluster", labelKey: "filters.clusters", types: ["star_cluster"] },
];

export const MAP_OBJECT_TYPE_FILTER_KEYS: readonly BodyFilter[] = [
  "all", "star", "planet", "moon", "dwarf_planet", "asteroid", "comet", "galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster",
];

export const MAP_FILTER_ZOOM_PRESETS: Partial<Record<BodyFilter, ZoomPreset>> = {
  star: "galaxy", planet: "galaxy", moon: "solar", dwarf_planet: "solar", asteroid: "solar", comet: "solar",
  galaxy: "cosmicWeb", quasar: "cosmicWeb", active_galaxy: "cosmicWeb", black_hole: "cosmicWeb",
  pulsar: "galaxy", nebula: "galaxy", star_cluster: "galaxy",
};

export const SOLAR_SYSTEM_COUNT_GROUPS = new Set(["core", "mars_moons", "jupiter_major_moons", "saturn_major_moons"]);
export const SOLAR_SYSTEM_COUNT_FILTERS = new Set<BodyFilter>(["planet", "moon", "dwarf_planet"]);

export const GUIDED_SETS: { id: string; labelKey: string; keys: string[] }[] = [
  { id: "solar-neighborhood", labelKey: "guided.solarNeighborhood", keys: ["sun", "earth", "moon", "mars", "jupiter", "saturn"] },
  { id: "bright-stars", labelKey: "guided.brightStars", keys: ["hip-32349", "hip-30438", "hip-69673", "hip-71683", "hip-91262", "hip-24436", "hip-24608"] },
  { id: "nearby-stars", labelKey: "guided.nearbyStars", keys: ["proxima-cen", "barnards-star", "eps-eri", "tau-cet", "gj-411"] },
  { id: "small-bodies", labelKey: "guided.smallBodies", keys: ["jpl-sbdb-20000001", "jpl-sbdb-20000004", "jpl-sbdb-20000433", "jpl-sbdb-1000036"] },
  { id: "exoplanets", labelKey: "guided.exoplanetSystems", keys: ["exosys-trappist-1", "exosys-55-cnc", "exosys-hr-8799", "exosys-kepler-11", "exosys-toi-700", "exosys-lhs-1140"] },
  { id: "deep-sky", labelKey: "guided.messierHighlights", keys: ["m1", "m13", "m31", "m42", "m45", "m57"] },
  { id: "galaxies", labelKey: "guided.galaxies", keys: ["m31", "m33", "m51", "m81", "m82", "m87"] },
  { id: "active-galaxies", labelKey: "guided.activeGalaxies", keys: ["simbad-m-87", "simbad-3c-273", "simbad-ngc-1068", "simbad-3c-279"] },
  { id: "nebulae", labelKey: "guided.nebulae", keys: ["m1", "m8", "m16", "m17", "m20", "m42", "m57"] },
];

export const EXPLORE_DOMAINS: ExploreDomainDefinition[] = [
  { id: "solar-system", titleKey: "explore.solarSystem.title", descriptionKey: "explore.solarSystem.description", filterKey: "solar_system", guidedSetId: "solar-neighborhood", zoomPreset: "solar", count: (_summary, bodies) => bodies.filter(isSolarSystemBody).length },
  { id: "nearby-stars", titleKey: "explore.nearbyStars.title", descriptionKey: "explore.nearbyStars.description", filterKey: "star", guidedSetId: "nearby-stars", zoomPreset: "nearby", count: (summary, bodies) => summary?.group_counts?.nearby_exoplanet_systems ?? bodies.filter((body) => body.catalog_group === "nearby_exoplanet_systems").length },
  { id: "messier-deep-sky", titleKey: "explore.messier.title", descriptionKey: "explore.messier.description", filterKey: "deep_sky", guidedSetId: "deep-sky", zoomPreset: "messier", count: (summary, bodies) => summary?.group_counts?.messier_deep_sky ?? bodies.filter((body) => body.catalog_group === "messier_deep_sky").length },
  { id: "galaxies", titleKey: "explore.galaxies.title", descriptionKey: "explore.galaxies.description", filterKey: "galaxy", guidedSetId: "galaxies", zoomPreset: "all", count: (summary, bodies) => summary?.type_counts?.galaxy ?? bodies.filter((body) => classifyBody(body).type === "galaxy").length },
  { id: "universe-scale", titleKey: "explore.universe.title", descriptionKey: "explore.universe.description", filterKey: "deep_sky", guidedSetId: "galaxies", zoomPreset: "cosmicWeb", count: (summary, bodies) => { const total = (summary?.type_counts?.galaxy ?? 0) + (summary?.type_counts?.quasar ?? 0) + (summary?.type_counts?.active_galaxy ?? 0); return total || bodies.filter((body) => ["galaxy", "quasar", "active_galaxy"].includes(classifyBody(body).type)).length; } },
  { id: "exoplanet-systems", titleKey: "explore.exoplanets.title", descriptionKey: "explore.exoplanets.description", filterKey: "exoplanet_system", guidedSetId: "exoplanets", zoomPreset: "nearby", count: (summary, bodies) => (summary?.group_counts?.nearby_exoplanet_systems ?? 0) + (summary?.group_counts?.exoplanet_systems ?? 0) || bodies.filter((body) => body.exoplanet_system).length },
  { id: "small-bodies", titleKey: "explore.smallBodies.title", descriptionKey: "explore.smallBodies.description", filterKey: "small_body", guidedSetId: "small-bodies", zoomPreset: "solar", count: (summary, bodies) => (summary?.type_counts?.asteroid ?? 0) + (summary?.type_counts?.comet ?? 0) + (summary?.type_counts?.small_body ?? 0) || bodies.filter((body) => ["asteroid", "comet", "small_body"].includes(classifyBody(body).type)).length },
];

export const TIME_STEPS = [
  { labelKey: "time.oneDay", days: 1 }, { labelKey: "time.oneWeek", days: 7 }, { labelKey: "time.oneMonth", days: 30 },
  { labelKey: "time.oneYear", days: 365.25 }, { labelKey: "time.tenYears", days: 3652.5 },
  { labelKey: "time.oneCentury", days: 36_525 }, { labelKey: "time.oneMillennium", days: 365_250 },
  { labelKey: "time.tenThousandYears", days: 3_652_500 }, { labelKey: "time.oneMillionYears", days: 365_250_000 },
];

export const OBSERVABLE_UNIVERSE_RADIUS_LY = 46_500_000_000;
export const UNIVERSE_SHELLS: UniverseShell[] = [
  { id: "current-view", labelKey: "universe.shell.currentView", radiusLy: 100_000, noteKey: "universe.shell.currentViewNote" },
  { id: "local-volume", labelKey: "universe.shell.localVolume", radiusLy: 35_000_000, noteKey: "universe.shell.localVolumeNote" },
  { id: "laniakea", labelKey: "universe.shell.laniakea", radiusLy: 260_000_000, noteKey: "universe.shell.laniakeaNote" },
  { id: "quasar-epoch", labelKey: "universe.shell.quasarEpoch", radiusLy: 13_000_000_000, noteKey: "universe.shell.quasarEpochNote" },
  { id: "observable", labelKey: "universe.shell.observable", radiusLy: OBSERVABLE_UNIVERSE_RADIUS_LY, noteKey: "universe.shell.observableNote" },
];
