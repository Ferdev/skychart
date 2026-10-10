import assert from "node:assert/strict";
import { bodyDiameterAu, fitCameraForBody, FIT_FILL_RATIO, ZOOM_PRESET_VIEW_WIDTH_AU, type CameraFitBody } from "../src/navigation/cameraFit.ts";

const AU_KM = 149_597_870.7;
const AU_PER_LY = 63_241.077;
const LY_KM = 9_460_730_472_580.8;
const desktop = { width: 873, height: 714 };
const phone = { width: 390, height: 330 };

function body(xAu: number, yAu: number, radiusKm: number, distanceKm: number, physicalDiameterLy?: number): CameraFitBody {
  return {
    position: { x_au: xAu, y_au: yAu, z_au: 0, heliocentric_distance_km: 0 } as CameraFitBody["position"],
    radius_km: radiusKm,
    distance_from_earth_km: distanceKm,
    deep_sky: physicalDiameterLy === undefined ? null : { physical_diameter_ly: physicalDiameterLy },
  };
}

function near(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-6, `${message}: ${actual} is not ${expected}`);
}

const base = { auKm: AU_KM, currentPxPerAu: 24 };

// M31: the catalog gives a diameter of 155,369 ly. The full galaxy is in the view, with margin.
{
  const m31 = body(1.2e11, -9.5e10, 7.349521951140282e17, 3_000_231 * LY_KM, 155_369);
  const camera = fitCameraForBody(m31, desktop, { ...base, type: "galaxy", typePreset: "cosmicWeb" });
  assert.equal(camera.xAu, 1.2e11);
  assert.equal(camera.yAu, -9.5e10);
  const diameterPx = 155_369 * AU_PER_LY * camera.pxPerAu;
  near(diameterPx, desktop.height * FIT_FILL_RATIO, "M31 fills 35% of the short side");
  assert.ok(diameterPx < desktop.height && diameterPx < desktop.width, "the full galaxy is in the view");
  const viewWidthLy = desktop.width / camera.pxPerAu / AU_PER_LY;
  assert.ok(viewWidthLy > 155_369 * 2, `the view (${Math.round(viewWidthLy)} ly) is wider than two galaxy diameters`);
  // The old rule (distance / 40 = 75,006 ly) made the view narrower than the galaxy.
  assert.ok(viewWidthLy > 3_000_231 / 40);
}

// Mars, Sirius, and Ceres have a radius: each fills 35% of the short side on desktop and on a phone.
for (const [name, radiusKm, type] of [["Mars", 3_389.5, "planet"], ["Sirius", 1_093_830.2, "star"], ["Ceres", 469.7, "dwarf_planet"]] as const) {
  for (const viewport of [desktop, phone]) {
    const camera = fitCameraForBody(body(1.5, 0.2, radiusKm, 1e8), viewport, { ...base, type, typePreset: "solar" });
    near((radiusKm * 2 / AU_KM) * camera.pxPerAu, Math.min(viewport.width, viewport.height) * FIT_FILL_RATIO, `${name} disc`);
    assert.equal(camera.xAu, 1.5);
  }
}

// 3C 273: no size in the catalog. The view is 1/40 of the distance wide, not the Solar System scale.
{
  const distanceLy = 2_443_000_000;
  const quasar = body(8e13, 9e13, 0, distanceLy * LY_KM);
  const camera = fitCameraForBody(quasar, desktop, { ...base, type: "active_galaxy", typePreset: "cosmicWeb" });
  near(desktop.width / camera.pxPerAu / AU_PER_LY, distanceLy / 40, "3C 273 view width in ly");
  assert.ok(camera.pxPerAu < 1e-9);
}

// A near deep-sky object of unknown size has a minimum view width of 1,000 AU.
{
  const camera = fitCameraForBody(body(0, 0, 0, 2_000 * AU_KM), desktop, { ...base, type: "nebula" });
  near(camera.pxPerAu, desktop.width / 1_000, "minimum deep-sky view width");
}

// A star with no radius uses the scale preset of its type. With no preset the scale does not change.
{
  const star = body(5e5, 1e5, 0, 8.6 * LY_KM);
  const withPreset = fitCameraForBody(star, desktop, { ...base, type: "star", typePreset: "galaxy" });
  near(withPreset.pxPerAu, desktop.width / ZOOM_PRESET_VIEW_WIDTH_AU.galaxy!, "galaxy preset scale");
  assert.equal(fitCameraForBody(star, desktop, { ...base, type: "star" }).pxPerAu, 24);
  assert.equal(fitCameraForBody(body(0, 0, Number.NaN, Number.NaN), desktop, { ...base, type: "unknown" }).pxPerAu, 24);
}

// The scale stays in the zoom range of the map.
assert.equal(fitCameraForBody(body(0, 0, 1e-9, 1), desktop, { ...base, type: "small_body" }).pxPerAu, 50_000_000);

assert.equal(bodyDiameterAu(body(0, 0, 0, 1), AU_KM), null);
near(bodyDiameterAu(body(0, 0, AU_KM, 1), AU_KM)!, 2, "diameter from the radius");
near(bodyDiameterAu(body(0, 0, 5, 1, 2), AU_KM)!, 2 * AU_PER_LY, "the deep-sky diameter is first");

console.log("camera fit tests passed");
