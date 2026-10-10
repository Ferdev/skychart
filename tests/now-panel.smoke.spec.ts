import {expect,test} from "@playwright/test";
test("Happening now uses canonical object permalink",async({page})=>{await page.route("**/api/now",r=>r.fulfill({contentType:"application/json",body:JSON.stringify({refreshed_at:"2026-07-15T12:00:00Z",stale:false,events:[{title:"Apophis close approach",summary:"Fixture approach.",starts_at:"2026-07-20T12:00:00Z",catalog_key:"99942-apophis",url:"/o/99942-apophis"}]})}));await page.goto("/");await expect(page.locator("#now-events a",{hasText:"Apophis close approach"})).toHaveAttribute("href","/o/99942-apophis");});

test("Happening now shows three rows, and Show all shows the others with no repeated row", async ({ page }) => {
  const event = (title: string, day: string) => ({ title, summary: `Fixture ${title}.`, starts_at: `2026-07-${day}T12:00:00Z`, catalog_key: null, url: `https://example.org/${encodeURIComponent(title)}-${day}` });
  // Six rows from the server: two of them have the same title and day.
  const events = [event("Event A", "20"), event("Event B", "21"), event("Event A", "20"), event("Event C", "22"), event("Event D", "23"), event("Event E", "24")];
  await page.route("**/api/now", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ refreshed_at: "2026-07-15T12:00:00Z", stale: false, events }) }));
  await page.goto("/");
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await page.locator("#header-search").click();
  const rows = page.locator("#now-events > li");
  await expect(rows).toHaveCount(5);
  await expect(page.locator("#now-events > li:not([hidden])")).toHaveCount(3);
  await expect(page.locator("#now-events > li:not([hidden]) a")).toHaveText(["Event A", "Event B", "Event C"]);
  const showAll = page.locator("#now-show-all");
  await expect(showAll).toBeVisible();
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await showAll.click();
  await expect(showAll).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#now-events > li:not([hidden])")).toHaveCount(5);
  // An external link has the new-tab hint.
  await expect(rows.first().locator("a")).toHaveAttribute("target", "_blank");
  await showAll.click();
  await expect(page.locator("#now-events > li:not([hidden])")).toHaveCount(3);
});

