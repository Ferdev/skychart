// Requires a running full application and an imported angular-only test record.
// No endpoint mocking and no service-unavailable skips.
import assert from 'node:assert/strict';
import { chromium, expect, request } from '@playwright/test';
const baseURL = process.env.ATLAS_BASE_URL ?? 'http://127.0.0.1:4020';
const key = process.env.CATALOG_UNKNOWN_KEY ?? 'ngc-unknown';
const api = await request.newContext({ baseURL });
const response = await api.get(`/api/objects/${encodeURIComponent(key)}`);
assert.equal(response.status(), 200, 'seed the angular-only catalog record before running');
const { object } = await response.json();
assert.equal(object.capabilities.spatial_position, false);
assert.equal(object.capabilities.angular_position, true);
assert.equal((await api.get('/api/ephemeris?groups=core')).status(), 200, 'live Python backend required');
const sky = await api.get('/api/catalog/sky?observer_x_au=0&observer_y_au=0&observer_z_au=0');
assert.equal(sky.status(), 200);
assert.ok((await sky.json()).points.some(point => point.key === key && point.direction_model === 'catalog_angular_no_parallax'));
await api.dispose();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
    const context = await browser.newContext({baseURL, viewport, isMobile:viewport.width < 500});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/?v=1&c=0,0&z=1&t=now&o=${encodeURIComponent(key)}`);
    await expect(page.locator('#load-state')).toHaveText('ready', {timeout:60000});
    await expect(page.locator('#selected-summary-name')).toContainText(object.name, {timeout:15000});
    await expect(page.locator('#center-selected')).toBeDisabled();
    await expect(page.locator('#zoom-selected')).toBeDisabled();
    await expect(page.locator('#view-sky-selected')).toBeDisabled();
    assert.ok(!/NaN|Infinity/.test(await page.locator('#selected-object-panel').innerText()));
    await page.goto('/sky/earth?v=1&t=2026-09-08T12%3A00%3A00.000Z&sc=0%2C0%2C72&lang=en');
    await expect(page.locator('#sky-view')).toBeVisible({timeout:60000});
    await expect(page.locator('#sky-view-title')).toContainText('Earth');
    await expect(page.locator('#sky-view-status')).toContainText(/\d+ catalog directions loaded/, {timeout:30000});
    await expect(page.locator('#sky-view-error')).toBeHidden();
    assert.ok(!/NaN|Infinity/.test(await page.locator('#sky-view').innerText()));
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Native shared-link inspection and sky loading passed at ${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser.close();
}
