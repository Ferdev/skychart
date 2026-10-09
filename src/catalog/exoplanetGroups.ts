/*
 * Catalog groups of the exoplanet layers. A confirmed planet and a planet
 * candidate use the same host-relative orbit code. A candidate is not a
 * confirmed planet, and each view that shows one says so.
 */
export const EXOPLANET_GROUP = "exoplanets";
export const EXOPLANET_CANDIDATE_GROUP = "exoplanet_candidates";
export const EXOPLANET_HOST_GROUP = "exoplanet_systems";
export const CURATED_HOST_GROUP = "nearby_exoplanet_systems";
export const EXOPLANET_CANDIDATE_HOST_GROUP = "exoplanet_candidate_hosts";

/** Groups that the map loads for a view that can show a host-relative orbit. */
export const EXOPLANET_VIEWPORT_GROUPS: readonly string[] = [
  EXOPLANET_HOST_GROUP, EXOPLANET_GROUP, EXOPLANET_CANDIDATE_HOST_GROUP, EXOPLANET_CANDIDATE_GROUP,
];

const ORBITING_GROUPS = new Set([EXOPLANET_GROUP, EXOPLANET_CANDIDATE_GROUP]);
const HOST_STAR_GROUPS = new Set([EXOPLANET_HOST_GROUP, CURATED_HOST_GROUP, EXOPLANET_CANDIDATE_HOST_GROUP]);

type Grouped = { catalog_group?: string | null };

/** True for a confirmed planet or a planet candidate: the catalog keeps each at the coordinates of its host star. */
export function orbitsHostStar(body: Grouped): boolean {
  return ORBITING_GROUPS.has(body.catalog_group ?? "");
}

/** True for a star that the atlas shows as the host of planets or of planet candidates. */
export function isExoplanetHostStar(body: Grouped): boolean {
  return HOST_STAR_GROUPS.has(body.catalog_group ?? "");
}

/** True for a planet candidate. A candidate is not a confirmed planet. */
export function isPlanetCandidate(body: Grouped): boolean {
  return body.catalog_group === EXOPLANET_CANDIDATE_GROUP;
}
