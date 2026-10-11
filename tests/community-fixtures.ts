import { type Page } from "@playwright/test";
import { skyEphemerisFixture } from "./atlas-test-utils";
export const photo = {
  id: "b735a4ed-7f42-4d76-a9a9-e8f42cebe4f1",
  declared_key: "sun",
  object_name: "Sun",
  title: "Sun portrait",
  caption: "<script>author text</script>",
  licence: "CC BY 4.0",
  captured_at: "2026-10-08T00:00:00Z",
  equipment: "Test telescope",
  processing: "Test processing",
  composite: false,
  author: { handle: "observer", name: "Observer" },
  votes: 3,
  thumbnail_url: "/test-community-image.png",
  image_url: "/test-community-image.png",
};
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC",
  "base64",
);
/** The private view of the fixture photo for a moderator. */
export const reviewPhoto = {
  ...photo,
  id: "0d3f6c52-91a8-4a0e-b6b2-5b1d6a4f7c10",
  title: "Orion Nebula, first light",
  declared_key: "m42",
  object_name: "M42 Orion Nebula",
  status: "review",
  submitted_at: "2026-10-09T21:30:00Z",
  width: 4096,
  height: 2731,
  author: { handle: "vera", name: "Vera R.", joined_at: "2026-09-01T00:00:00Z", suspended: false, published: 2, rejected: 0 },
  duplicates: [],
  reports: [],
  last_action: null,
};
export const photographer = { handle: "observer", name: "Observer", h_index: 2, photos: 12, objects: 9, votes: 31, covers: 4, first_photos: 2 };
export async function communityFixture(page: Page, options: { role?: string } = {}) {
  const state = {
    role: options.role ?? "member",
    queue: [reviewPhoto] as (typeof reviewPhoto)[],
    reports: [] as { id: string; reason: string; photo: unknown }[],
    coverageRequests: [] as string[],
    rankingRequests: [] as string[],
    reviews: [] as { path: string; body: { action?: string; reason?: string } }[],
    removed: false,
    indexRequests: 0,
    votes: 3,
    signed: false,
    uploads: 0,
    csrfSeen: false,
  };
  await page.route("**/test-community-image.png", (r) =>
    r.fulfill({ contentType: "image/png", body: image }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/community/config") data = { enabled: true };
    else if (path === "/api/community/session" || path === "/api/community/me")
      data = {
        user: state.signed
          ? { id: "user", handle: "reader", name: "Reader", role: state.role }
          : null,
        csrf: "test-csrf",
        photos: state.signed
          ? [{ id: reviewPhoto.id, title: "My Moon", status: "review", object_name: "Moon", thumbnail_url: "/test-community-image.png", inserted_at: "2026-10-09T21:30:00Z", votes: 0 }]
          : [],
        review_count: state.signed && ["admin", "moderator"].includes(state.role) ? state.queue.length + state.reports.length : 0,
      };
    else if (path === "/api/community/code") data = { sent: true };
    else if (path === "/api/community/verify") {
      state.signed = true;
      data = {
        user: { id: "user", handle: "reader", name: "Reader", role: state.role },
        csrf: "test-csrf",
      };
    } else if (path === "/api/photos/index") {
      state.indexRequests++;
      data = {
        version: state.removed ? 2 : 1,
        more: false,
        items: [
          {
            subject_id: "subject",
            keys: ["sun", "sun-alias"],
            name: "Sun",
            count: state.removed ? 0 : 1,
            cover: state.removed ? null : photo,
          },
        ],
      };
    } else if (/^\/api\/community\/photos\/[^/]+\/review$/.test(path)) {
      const body = route.request().postDataJSON();
      state.reviews.push({ path, body });
      if (body?.action === "hide") state.removed = true;
      state.queue = state.queue.filter((item) => !path.includes(item.id));
    } else if (path === "/api/community/review")
      data = {
        counts: { review: state.queue.length, reports: state.reports.length, published: state.removed ? 0 : 1, hidden: 0, rejected: 0 },
        photos: state.queue,
        reports: state.reports,
      };
    else if (path === "/api/community/review/photos")
      data = { photos: state.removed ? [] : [{ ...reviewPhoto, ...photo, status: "published" }] };
    else if (path === "/api/community/review/log")
      data = { actions: [{ action: "approve", reason: "Approved", at: "2026-10-08T10:00:00Z", moderator: "Reader", photo_id: photo.id, photo_title: photo.title }] };
    else if (path === "/api/community/photographers") data = { photographers: [photographer] };
    else if (path.startsWith("/api/community/photographers/"))
      data = { photographer: { ...photographer, rank: 1, joined_at: "2026-09-01T00:00:00Z" }, photos: [photo] };
    else if (path === "/api/community/coverage") {
      const query = new URL(route.request().url()).searchParams;
      state.coverageRequests.push(query.toString());
      const objects = [
        { key: "m31", name: "M31 Andromeda Galaxy", catalog: "messier", type: "Galaxy", constellation: "And", magnitude: 3.4 },
        { key: "m45", name: "M45 Pleiades", catalog: "messier", type: "Open cluster", constellation: "Tau", magnitude: 1.6 },
        { key: "ngc-253", name: "NGC 253", catalog: "ngc", type: "Galaxy", constellation: "Scl", magnitude: 7.1 },
      ].filter((object) => (!query.get("catalog") || object.catalog === query.get("catalog")) && object.name.toLowerCase().includes((query.get("q") ?? "").toLowerCase()));
      data = {
        total: 13418,
        covered: 3,
        matched: objects.length,
        catalogs: { messier: { total: 110, covered: 3 }, ngc: { total: 7916, covered: 0 }, ic: { total: 5028, covered: 0 } },
        objects,
      };
    } else if (path.endsWith("/photos"))
      data = { photos: state.removed ? [] : [photo] };
    else if (path === "/api/photos/" + photo.id)
      data = { ...photo, votes: state.votes };
    else if (path.endsWith("/vote")) {
      if (route.request().method() === "GET") data = { present: false };
      else {
        state.csrfSeen =
          route.request().headers()["x-community-csrf"] === "test-csrf";
        state.votes += route.request().method() === "POST" ? 1 : -1;
        data = { votes: state.votes };
      }
    } else if (path === "/api/community/uploads") {
      state.uploads++;
      state.csrfSeen =
        route.request().headers()["x-community-csrf"] === "test-csrf";
      data = {
        photo_id: photo.id,
        upload: { url: "/test-upload", method: "PUT" },
      };
    } else if (path.endsWith("/complete")) data = { status: "processing" };
    else if (path === "/api/community/rankings") {
      state.rankingRequests.push(new URL(route.request().url()).searchParams.get("period") ?? "");
      data = { photos: state.removed ? [] : [{ ...photo, votes: state.votes }] };
    }
    else if (path === "/api/catalog")
      data = {
        object_count: 2,
        group_counts: { core: 2 },
        type_counts: {},
        available_groups: ["core"],
      };
    else if (path === "/api/ephemeris")
      data = skyEphemerisFixture("2026-10-08T00:00:00Z");
    else if (path === "/api/catalog/search")
      data = { objects: [], total: 0, has_more: false };
    else if (path === "/api/catalog/sky") data = { points: [], returned: 0 };
    else if (path === "/api/catalog/viewport") data = { objects: [], total: 0 };
    else if (path === "/api/spacecraft") data = { bodies: [] };
    else if (path === "/api/now") data = { events: [], stale: false };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.route("**/catalog-tiles/**", (r) =>
    r.fulfill({ status: 404, body: "" }),
  );
  await page.route("**/test-upload", (r) =>
    r.fulfill({ status: 200, body: "" }),
  );
  return state;
}
