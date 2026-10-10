import { type Page } from "@playwright/test";
import { skyEphemerisFixture } from "./atlas-test-utils";
export const photo = {
  id: "b735a4ed-7f42-4d76-a9a9-e8f42cebe4f1",
  declared_key: "sun",
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
export async function communityFixture(page: Page, options: { role?: string } = {}) {
  const state = {
    role: options.role ?? "member",
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
        photos: [],
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
    else if (path === "/api/community/rankings") data = { photos: [photo] };
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
