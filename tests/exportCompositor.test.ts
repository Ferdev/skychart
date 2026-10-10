import assert from "node:assert/strict";
import { exportDimensions, exportTileCamera, niceScaleBarAu } from "../src/exportCompositor.ts";

type Tile = { left: number; top: number; width: number; height: number };

const provenance = { centerXAu: 1.25, centerYAu: -0.5, pxPerAu: 24 };

/**
 * Pixel of the export where the point layer draws a world position. The renderer puts the tile camera at the
 * tile centre. It works in CSS pixels and multiplies by the device pixel ratio, which is the export scale
 * (`u_center + world * u_px_per_au` in the shader of `webglPointRenderer.ts`).
 */
function pointLayerPixel(world: { xAu: number; yAu: number }, tile: Tile, camera: { xAu: number; yAu: number; pxPerAu: number }, scale: number) {
  return {
    x: tile.left + tile.width / 2 + (world.xAu - camera.xAu) * camera.pxPerAu * scale,
    y: tile.top + tile.height / 2 - (world.yAu - camera.yAu) * camera.pxPerAu * scale,
  };
}

/** Pixel of the export where the overlay canvas shows a world position. The overlay is a scaled copy of the screen. */
function overlayPixel(world: { xAu: number; yAu: number }, window: { width: number; height: number }, freeArea: { left: number; top: number; right: number; bottom: number }, scale: number) {
  const centerX = (freeArea.left + freeArea.right) / 2;
  const centerY = (freeArea.top + freeArea.bottom) / 2;
  return {
    x: (centerX + (world.xAu - provenance.centerXAu) * provenance.pxPerAu) * scale,
    y: (centerY - (world.yAu - provenance.centerYAu) * provenance.pxPerAu) * scale,
  };
}

function tilesFor(size: { width: number; mapHeight: number }, tileSize: number): Tile[] {
  const tiles: Tile[] = [];
  for (let top = 0; top < size.mapHeight; top += tileSize) {
    for (let left = 0; left < size.width; left += tileSize) {
      tiles.push({ left, top, width: Math.min(tileSize, size.width - left), height: Math.min(tileSize, size.mapHeight - top) });
    }
  }
  return tiles;
}

const window = { width: 1440, height: 900 };
const layouts = [
  // The header and the toolbar take 176 px at the top: the free map area starts 176 px below the top.
  { name: "free area 176 px below the top", freeArea: { left: 0, top: 176, right: 1440, bottom: 900 } },
  // The inspector is open on the right, so the free area is also narrower.
  { name: "inspector open", freeArea: { left: 0, top: 176, right: 873, bottom: 760 } },
  { name: "full window", freeArea: { left: 0, top: 0, right: 1440, bottom: 900 } },
];
const worlds = [
  { xAu: provenance.centerXAu, yAu: provenance.centerYAu },
  { xAu: 0, yAu: 0 },
  { xAu: -9.5, yAu: 4.2 },
];

for (const layout of layouts) {
  const offset = {
    x: (layout.freeArea.left + layout.freeArea.right) / 2 - window.width / 2,
    y: (layout.freeArea.top + layout.freeArea.bottom) / 2 - window.height / 2,
  };
  // Current resolution, 4K wide, and 8K.
  for (const requestedWidth of [1440, 3840, 8000]) {
    const size = exportDimensions(requestedWidth, window.width, window.height);
    for (const tile of tilesFor(size, 2048)) {
      const camera = exportTileCamera(provenance, size, tile, offset);
      assert.equal(camera.pxPerAu, provenance.pxPerAu, "the renderer applies the export scale as its device pixel ratio");
      for (const world of worlds) {
        const points = pointLayerPixel(world, tile, camera, size.scale);
        const overlay = overlayPixel(world, window, layout.freeArea, size.scale);
        assert.ok(Math.abs(points.x - overlay.x) < 1e-6 && Math.abs(points.y - overlay.y) < 1e-6,
          `${layout.name}, width ${requestedWidth}: point layer ${JSON.stringify(points)} and overlay ${JSON.stringify(overlay)} must agree`);
      }
    }
  }
}

// The offset of the review: (176 + 900 - 900) / 2 = 88 px. With no offset, the point layer is 88 px too high.
{
  const size = exportDimensions(1440, window.width, window.height);
  const tile = { left: 0, top: 0, width: size.width, height: size.mapHeight };
  const world = { xAu: provenance.centerXAu, yAu: provenance.centerYAu };
  const withOffset = pointLayerPixel(world, tile, exportTileCamera(provenance, size, tile, { x: 0, y: 88 }), size.scale);
  const noOffset = pointLayerPixel(world, tile, exportTileCamera(provenance, size, tile, { x: 0, y: 0 }), size.scale);
  assert.deepEqual(withOffset, { x: 720, y: 538 });
  assert.deepEqual(noOffset, { x: 720, y: 450 });
}

assert.deepEqual(exportDimensions(3840, 1440, 900), { width: 3840, mapHeight: 2400, footerHeight: 235, scale: 3840 / 1440 });
assert.equal(niceScaleBarAu(24, 120), 5);

console.log("export compositor tests passed");
