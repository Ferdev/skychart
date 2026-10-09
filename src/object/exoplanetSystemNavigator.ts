import type { Body, BodyExoplanet, Camera } from "../atlas/contracts";
import type { CatalogObjectMapper } from "../catalog/catalogObjectMapper";
import { isExoplanetHostStar, orbitsHostStar } from "../catalog/exoplanetGroups";
import { exoplanetOrbitReachAu } from "../catalog/exoplanetOrbit";
import { isAtHost, loadExoplanetSystemObjects } from "../catalog/exoplanetSystemLoader";
import type { Rect } from "../geometry";

type HostPosition = { x_au: number; y_au: number; z_au: number };

type ExoplanetSystemNavigatorOptions = {
  /** Element that contains the "View planetary system" action. */
  root: HTMLElement;
  mapper: CatalogObjectMapper;
  body: (key: string) => Body | undefined;
  bodies: () => readonly Body[];
  mergeBodies: (bodies: readonly Body[]) => void;
  viewport: () => Rect;
  animateCameraTo: (target: Camera) => void;
  maximumZoom: number;
};

// The largest orbit fills the view with this margin on each side.
const SYSTEM_VIEW_MARGIN_RATIO = 0.25;

/** Moves the map to a host star and fits the largest orbit of its planets and planet candidates. */
export class ExoplanetSystemNavigator {
  private requestId = 0;

  constructor(private readonly options: ExoplanetSystemNavigatorOptions) {
    options.root.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-planetary-system]") : null;
      if (button?.dataset.planetarySystem) void this.view(button.dataset.planetarySystem);
    });
  }

  /** Loads the planets and the planet candidates of the host star at this position into the atlas body list, at the atlas time. */
  async load(host: HostPosition): Promise<void> {
    const objects = await loadExoplanetSystemObjects(host);
    this.options.mergeBodies(objects.map((object) => this.options.mapper.map(object)));
  }

  async view(key: string): Promise<void> {
    const body = this.options.body(key);
    if (!body) return;
    const host = body.exoplanet_orbit?.host_position
      ?? { x_au: body.position.x_au, y_au: body.position.y_au, z_au: body.position.z_au };
    const requestId = ++this.requestId;
    try {
      await this.load(host);
    } catch (error) {
      // The planets that are in memory still give the system size.
      console.warn("Unable to load the planets of this system.", error);
    }
    if (requestId !== this.requestId) return;

    const reachAu = this.systemReachAu(body, host);
    const rect = this.options.viewport();
    const fitPx = Math.min(rect.width, rect.height) / (2 * (1 + SYSTEM_VIEW_MARGIN_RATIO));
    this.options.animateCameraTo({
      xAu: host.x_au,
      yAu: host.y_au,
      pxPerAu: Math.min(this.options.maximumZoom, fitPx / reachAu),
    });
  }

  /** Largest distance from the host star that an orbit of this system reaches, in AU. */
  private systemReachAu(body: Body, host: HostPosition): number {
    const orbits = this.options.bodies()
      .filter((candidate) => candidate.exoplanet_orbit && isAtHost(candidate.exoplanet_orbit.host_position, host))
      .map((candidate) => exoplanetOrbitReachAu(candidate) ?? 0);
    const planets: Pick<BodyExoplanet, "semi_major_axis_au">[] = [...(body.exoplanet_system?.planets ?? []), ...(body.planet_candidates ?? [])];
    const listed = planets.map((planet) => planet.semi_major_axis_au ?? 0);
    const reachAu = Math.max(0, ...orbits, ...listed);
    // With no orbit size in the archive, the view keeps a star-sized scale.
    return reachAu > 0 ? reachAu : 1;
  }
}

/**
 * True when the atlas can show a planetary system for this body: a planet or
 * a planet candidate with an orbit, a host star, or a star record of another
 * catalog that has planet candidates.
 */
export function hasPlanetarySystemView(body: Body): boolean {
  if (orbitsHostStar(body)) return Boolean(body.exoplanet_orbit && body.exoplanet_orbit.display_state !== "none");
  return isExoplanetHostStar(body) || Boolean(body.planet_candidates?.length);
}
