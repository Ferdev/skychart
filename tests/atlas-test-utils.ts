import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

export const ATLAS_BASE_URL = process.env.ATLAS_BASE_URL ?? "http://127.0.0.1:4020";

export type BrowserIssueCollector = {
  errors: string[];
  assertClean(): void;
};

type AtlasPerfEntry = {
  url: string;
  startedAt: number;
  finishedAt: number | null;
  status: number | null;
  failed: boolean;
};

type AtlasPerfState = {
  rafCount: number;
  fetches: AtlasPerfEntry[];
};

export async function skipIfAtlasUnavailable(request: APIRequestContext) {
  try {
    const response = await request.get(ATLAS_BASE_URL, { timeout: 5_000 });
    test.skip(!response.ok(), `Cosmic Atlas is not available at ${ATLAS_BASE_URL}; got HTTP ${response.status()}.`);
  } catch (error) {
    test.skip(true, `Cosmic Atlas is not available at ${ATLAS_BASE_URL}: ${String(error)}`);
  }
}

export async function openAtlas(page: Page, path = "/") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
  await expect(page.locator("#map")).toBeVisible();
}

export async function openSearchWorkspace(page: Page) {
  const catalogTab = page.locator('[data-tab="catalog"]');
  if (await catalogTab.isVisible()) await catalogTab.click();
  else await page.locator("#workspace-search-link").click();
  await expect(page.locator("#tab-catalog")).toBeVisible();
  await expect(page.locator("#body-search")).toBeVisible();
}

export async function selectCatalogObject(page: Page, query: string, key: string, expectedName: RegExp | string = query) {
  await openSearchWorkspace(page);
  await page.locator("#body-search").fill(query);
  const result = page.locator(`#body-picker [data-body-key="${key}"]`).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator("#selected-object-panel")).toBeVisible();
  await expect(page.locator("#selected-summary-name")).toContainText(expectedName);
}

export function skyEphemerisFixture(timestamp: string) {
  const position = (xAu: number) => ({
    x_au: xAu, y_au: 0, z_au: 0,
    x_km: xAu * 149_597_870.7, y_km: 0, z_km: 0,
    heliocentric_distance_km: Math.abs(xAu) * 149_597_870.7,
  });
  return {
    timestamp_utc: new Date(timestamp).toISOString(),
    generated_at_utc: "2026-08-26T12:00:00.000Z",
    data_source: "Sky view smoke fixture",
    coordinate_frame: "Heliocentric ecliptic Cartesian coordinates",
    au_km: 149_597_870.7,
    catalog: { groups: {}, object_count: 2, group_counts: { core: 2 } },
    bodies: [{
      key: "sun", name: "Sun", radius_km: 695_700, color: "#ffd166",
      object_type: "star", catalog_group: "core", position: position(0),
      distance_from_earth_km: 149_597_870.7,
    }, {
      key: "earth", name: "Earth", radius_km: 6_371, color: "#62a8ff",
      object_type: "planet", parent_key: "sun", catalog_group: "core", position: position(1),
      distance_from_earth_km: 0,
    }],
  };
}

export function collectBrowserIssues(page: Page): BrowserIssueCollector {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const locationUrl = message.location().url;
    if (message.text() === "Failed to load resource: the server responded with a status of 404 (Not Found)" && locationUrl) {
      try {
        const location = new URL(locationUrl);
        const atlas = new URL(page.url());
        if (location.origin === atlas.origin && location.pathname === "/catalog-tiles/v1/manifest.json") return;
      } catch {
        // Keep malformed or non-URL console locations visible to the assertion.
      }
    }
    errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return {
    errors,
    assertClean() {
      expect(errors, "browser console/page errors").toEqual([]);
    }
  };
}

export async function installAtlasPerfInstrumentation(page: Page) {
  await page.addInitScript(() => {
    type WindowWithAtlasPerf = Window & {
      __atlasPerf?: AtlasPerfState;
      __resetAtlasPerf?: () => void;
    };

    type AtlasPerfEntry = {
      url: string;
      startedAt: number;
      finishedAt: number | null;
      status: number | null;
      failed: boolean;
    };

    type AtlasPerfState = {
      rafCount: number;
      fetches: AtlasPerfEntry[];
    };

    const perfWindow = window as WindowWithAtlasPerf;
    const perfState: AtlasPerfState = { rafCount: 0, fetches: [] };
    perfWindow.__atlasPerf = perfState;
    perfWindow.__resetAtlasPerf = () => {
      perfState.rafCount = 0;
      perfState.fetches = [];
    };

    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      perfState.rafCount += 1;
      return originalRequestAnimationFrame(callback);
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const entry: AtlasPerfEntry = {
        url,
        startedAt: performance.now(),
        finishedAt: null,
        status: null,
        failed: false
      };
      perfState.fetches.push(entry);

      try {
        const response = await originalFetch(input, init);
        entry.status = response.status;
        return response;
      } catch (error) {
        entry.failed = true;
        throw error;
      } finally {
        entry.finishedAt = performance.now();
      }
    };
  });
}

export async function resetAtlasPerf(page: Page) {
  await page.evaluate(() => {
    (window as Window & { __resetAtlasPerf?: () => void }).__resetAtlasPerf?.();
  });
}

export async function readAtlasPerf(page: Page): Promise<AtlasPerfState> {
  return page.evaluate(() => {
    const state = (window as Window & { __atlasPerf?: AtlasPerfState }).__atlasPerf;
    return state ? { rafCount: state.rafCount, fetches: [...state.fetches] } : { rafCount: 0, fetches: [] };
  });
}

export function catalogEndpointEntries(state: AtlasPerfState) {
  return state.fetches.filter((entry) => /(?:\/api\/catalog\/(points\.bin|viewport)|\/catalog-tiles\/[^/]+\/.*\.(?:bin|smpk))/.test(entry.url));
}

export async function waitForCatalogRequestsToSettle(page: Page, quietMs = 800, timeoutMs = 12_000) {
  await page.waitForFunction(
    ({ quietMs }) => {
      const state = (window as Window & { __atlasPerf?: AtlasPerfState }).__atlasPerf;
      if (!state) return true;
      const relevant = state.fetches.filter((entry) => /(?:\/api\/catalog\/(points\.bin|viewport)|\/catalog-tiles\/[^/]+\/.*\.(?:bin|smpk))/.test(entry.url));
      if (relevant.some((entry) => entry.finishedAt === null)) return false;
      const latestStartedAt = Math.max(0, ...relevant.map((entry) => entry.startedAt));
      return performance.now() - latestStartedAt >= quietMs;
    },
    { quietMs },
    { timeout: timeoutMs }
  );
}
