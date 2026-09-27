import { expect, test, type Page } from "@playwright/test";
import { ATLAS_BASE_URL, collectBrowserIssues } from "./atlas-test-utils";

test.use({ video: "off" });

async function installRendererScene(page: Page) {
  await page.route("**/realism-fixture", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html>
    <html><head><meta charset="utf-8"><title>3D appearance verification</title><style>
    body{display:flow-root;width:800px;margin:0;padding:1px 0;background:#030609;color:#d4e3e7;font:16px system-ui}h1{font-size:20px;margin:18px 24px}
    #scene{position:relative;width:800px;height:560px}canvas{position:absolute;inset:0;width:800px;height:560px}
    #bodies{z-index:1}#clouds{z-index:2}p{margin:12px 24px;color:#92a4ab}</style></head>
    <body><h1 id="name">Cosmic Atlas · 3D appearance</h1><div id="scene"><canvas id="bodies"></canvas><canvas id="clouds"></canvas></div>
    <p>Catalog radius · static source maps · inferred deep-sky structure</p></body></html>` }));
  await page.goto(`${ATLAS_BASE_URL}/realism-fixture`);
  await page.evaluate(async () => {
    const { UniverseBodyRenderer } = await import("/src/universe/universeBodyRenderer.ts");
    const { UniverseDeepSkyRenderer } = await import("/src/universe/universeDeepSkyRenderer.ts");
    const { cameraForDirection } = await import("/src/sky/skyProjection.ts");
    const { bodyOccluders } = await import("/src/universe/universeOcclusion.ts");
    const bodyCanvas = document.querySelector<HTMLCanvasElement>("#bodies")!;
    const cloudCanvas = document.querySelector<HTMLCanvasElement>("#clouds")!;
    let draw = () => {};
    const bodies = new UniverseBodyRenderer(bodyCanvas, () => requestAnimationFrame(() => draw()));
    const clouds = new UniverseDeepSkyRenderer(cloudCanvas, () => requestAnimationFrame(() => draw()));
    let scene: any[] = [], observer = { x: -97, y: 0, z: .5 }, moving = false;
    const render = () => {
      const camera = cameraForDirection({ x: -100-observer.x, y: -observer.y, z: -observer.z }, 60);
      const occluders = bodyOccluders(scene, observer, camera, 800, 560);
      bodies.render(scene, observer, camera, 800, 560, 1, moving);
      clouds.render(scene, observer, camera, 800, 560, 1, occluders, moving, scene[0]?.key);
    };
    draw = render;
    (window as any).realism = {
      bodies, clouds, render,
      show(key: string, object_type: string, offset = [3, 0, .5], flight = false, releaseMaps = true) {
        if (releaseMaps) bodies.release();
        observer = { x: -100+offset[0]!, y: offset[1]!, z: offset[2]! }; moving = flight;
        scene = [{ key, object_type, position: { x: -100, y: 0, z: 0 }, radiusKm: 149597870.7, color: "#dbb891" }];
        document.querySelector("#name")!.textContent = `Cosmic Atlas · ${key}`;
        render();
      },
      transmissionScene(foreground: boolean) {
        observer = { x: -97, y: 0, z: 0 };
        scene = [{ key: "jupiter", object_type: "planet", position: { x: -100, y: 0, z: 0 }, radiusKm: 149597870.7 },
          { key: "m13", object_type: "star_cluster", position: { x: foreground ? -98 : -110, y: 0, z: 0 }, radiusKm: 149597870.7 * .25 }];
        render();
      },
      cloudChecksum() {
        render(); const gl = cloudCanvas.getContext("webgl");
        if (!gl) return 0;
        const data = new Uint8Array(cloudCanvas.width*cloudCanvas.height*4);
        gl.readPixels(0,0,cloudCanvas.width,cloudCanvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
        return data.reduce((sum, value, i) => (sum + value*(i%131+1)) % 2147483647, 0);
      },
      centerCloudAlpha() {
        render(); const gl = cloudCanvas.getContext("webgl")!, pixel = new Uint8Array(4);
        gl.readPixels(400,280,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel); return pixel[3];
      },
      pixels() {
        render(); const gl = bodyCanvas.getContext("webgl");
        const data = new Uint8Array(800*560*4);
        if (gl) gl.readPixels(0,0,800,560,gl.RGBA,gl.UNSIGNED_BYTE,data);
        else data.set(bodyCanvas.getContext("2d")!.getImageData(0,0,800,560).data);
        const colors = new Set<number>(); let opaque=0, partial=0, lit=0, dark=0;
        for(let i=0;i<data.length;i+=4){if(data[i+3]!>240){opaque++;if(data[i]!+data[i+1]!+data[i+2]!>180)lit++;else dark++;
          colors.add((data[i]!>>3)*1024+(data[i+1]!>>3)*32+(data[i+2]!>>3));}else if(data[i+3]!>5)partial++;}
        return { opaque, partial, lit, dark, colors: colors.size };
      },
    };
  });
}

test("mapped surfaces, ring sides, illumination and context restoration", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page);
  await installRendererScene(page);
  const cases = [
    ["jupiter", [3, 0, .5], "jupiter.png"], ["saturn", [4, 0, 1.6], "saturn.jpg"],
    ["earth", [1.2, 3, .4], "earth-clouds.jpg"], ["moon", [1.2, 3, .3], "moon-height.jpg"],
    ["mars", [2.5, 1.2, .4], "mars.jpg"],
  ] as const;
  for (const [key, offset, texture] of cases) {
    await page.evaluate(([key, offset]) => (window as any).realism.show(key, key === "moon" ? "moon" : "planet", offset), [key, offset]);
    await expect(page.locator("#bodies")).toHaveAttribute("data-loaded-textures", new RegExp(texture));
    const pixels = await page.evaluate(() => (window as any).realism.pixels());
    expect(pixels.opaque, `${key} has a resolved surface`).toBeGreaterThan(10_000);
    expect(pixels.colors, `${key} map variation`).toBeGreaterThan(70);
    if (key === "saturn") expect(pixels.partial, "rings have translucent coverage").toBeGreaterThan(1000);
    if (key === "earth" || key === "moon") expect(pixels.dark, "terminator and night hemisphere").toBeGreaterThan(2000);
    expect(Number(await page.locator("#bodies").getAttribute("data-texture-bytes"))).toBeLessThanOrEqual(48*1024*1024);
    await page.locator("body").screenshot({ path: testInfo.outputPath(`${key}-realism.png`) });
  }
  await page.evaluate(() => (window as any).realism.show("saturn", "planet", [4, 0, -1.6]));
  await expect(page.locator("#bodies")).toHaveAttribute("data-loaded-textures", /saturn.jpg/);
  expect((await page.evaluate(() => (window as any).realism.pixels())).partial).toBeGreaterThan(1000);
  await page.locator("body").screenshot({ path: testInfo.outputPath("saturn-other-side.png") });
  await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>("#bodies")!;
    const extension = canvas.getContext("webgl")!.getExtension("WEBGL_lose_context")!;
    await new Promise<void>((resolve) => {
      canvas.addEventListener("webglcontextrestored", () => resolve(), { once: true });
      canvas.addEventListener("webglcontextlost", () => setTimeout(() => extension.restoreContext(), 200), { once: true });
      extension.loseContext();
    });
  });
  expect((await page.evaluate(() => (window as any).realism.pixels())).opaque).toBeGreaterThan(10_000);
  await page.evaluate(() => (window as any).realism.bodies.release());
  await expect(page.locator("#bodies")).toHaveAttribute("data-texture-bytes", "0");
  issues.assertClean();
});

test("all guided morphologies retain depth, aliases and foreground occlusion", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page);
  await installRendererScene(page);
  const types: Record<string,string> = { m1: "nebula", m8: "nebula", m13: "star_cluster", m16: "star_cluster", m17: "nebula",
    m20: "nebula", m31: "galaxy", m33: "galaxy", m42: "nebula", m45: "star_cluster", m51: "galaxy", m57: "nebula",
    m77: "galaxy", m81: "galaxy", m82: "galaxy", m87: "galaxy", "simbad-m-87": "active_galaxy",
    "simbad-3c-273": "active_galaxy", "simbad-3c-279": "active_galaxy" };
  const checksums: Record<string,number> = {};
  for (const [key, type] of Object.entries(types)) {
    await page.evaluate(([key, type]) => (window as any).realism.show(key, type, [2.4,0,0]), [key,type]);
    await expect(page.locator("#clouds")).toHaveAttribute("data-visible-objects", key);
    expect(Number(await page.locator("#clouds").getAttribute("data-particle-count"))).toBeGreaterThan(1000);
    checksums[key] = await page.evaluate(() => (window as any).realism.cloudChecksum());
    expect(checksums[key]).toBeGreaterThan(0);
    if (["m31","m42","m57","m1","m13","m45","m51","m82","m87"].includes(key))
      await page.locator("body").screenshot({ path: testInfo.outputPath(`${key}-realism.png`) });
  }
  expect(checksums.m87).toBe(checksums["simbad-m-87"]);
  await page.evaluate(() => (window as any).realism.show("m31", "galaxy", [0,2.4,.2]));
  const side = await page.evaluate(() => (window as any).realism.cloudChecksum());
  expect(side).not.toBe(checksums.m31);
  await page.locator("body").screenshot({ path: testInfo.outputPath("m31-side.png") });
  await page.evaluate(() => (window as any).realism.show("m42", "nebula", [.2,.1,.1], true));
  expect(await page.evaluate(() => (window as any).realism.cloudChecksum())).toBeGreaterThan(0);
  expect(Number(await page.locator("#clouds").getAttribute("data-particle-count"))).toBeLessThanOrEqual(12_000);
  expect(Number(await page.locator("#clouds").getAttribute("data-splat-pixel-area"))).toBeLessThanOrEqual(800*560*6);
  await page.evaluate(() => (window as any).realism.transmissionScene(false));
  expect(await page.evaluate(() => (window as any).realism.centerCloudAlpha())).toBe(0);
  await page.evaluate(() => (window as any).realism.transmissionScene(true));
  expect(await page.evaluate(() => (window as any).realism.centerCloudAlpha())).toBeGreaterThan(0);
  issues.assertClean();
});

test("lazy asset cache stays bounded across visits and unknown surfaces stay usable", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page), images: string[] = [];
  page.on("request", (request) => { if (/textures\/universe\/.*\.(jpg|png)$/.test(request.url())) images.push(request.url()); });
  await installRendererScene(page);
  await page.evaluate(() => (window as any).realism.show("jupiter", "planet", [1000,0,0]));
  expect(images).toHaveLength(0);
  for (const key of ["jupiter", "earth", "moon", "io", "mercury", "neptune"]) {
    await page.evaluate((key) => (window as any).realism.show(key, key === "moon" || key === "io" ? "moon" : "planet", [3,0,.5], false, false), key);
    await expect(page.locator("#bodies")).toHaveAttribute("data-loaded-textures", new RegExp(`${key}\\.(jpg|png)`));
    expect(Number(await page.locator("#bodies").getAttribute("data-texture-bytes"))).toBeLessThanOrEqual(48*1024*1024);
  }
  for (const [key, type] of [["sun", "star"], ["unknown-star", "star"], ["unknown-asteroid", "asteroid"], ["unknown-comet", "comet"], ["pluto", "dwarf_planet"], ["unknown-exoplanet", "planet"]]) {
    await page.evaluate(([key, type]) => (window as any).realism.show(key,type), [key,type]);
    expect((await page.evaluate(() => (window as any).realism.pixels())).opaque).toBeGreaterThan(10_000);
  }
  const timing = await page.evaluate(async () => {
    const result = [];
    for (const [key, type] of [["jupiter", "planet"], ["m31", "galaxy"], ["m42", "nebula"]]) {
      (window as any).realism.show(key, type, [3,0,.5], true);
      const times = [];
      for (let i=0; i<8; i++) {
        await new Promise(requestAnimationFrame);
        const start = performance.now(); (window as any).realism.render(); times.push(performance.now()-start);
      }
      times.sort((a,b)=>a-b); result.push({ key, p75CpuMs: times[5], points: Number(document.querySelector("#clouds")!.getAttribute("data-particle-count")) });
    }
    return result;
  });
  await testInfo.attach("realism-cpu-samples", { body: JSON.stringify(timing,null,2), contentType: "application/json" });
  console.log("Realism synthetic browser samples:", JSON.stringify(timing));
  expect(timing.every((scene) => scene.points <= 12000)).toBe(true);
  await page.evaluate(() => (window as any).realism.show("sun", "star", [.001,0,0], true));
  expect(await page.locator("#bodies").evaluate((canvas: HTMLCanvasElement) => canvas.width*canvas.height)).toBeLessThanOrEqual(400_000);
  await page.evaluate(() => (window as any).realism.show("jupiter", "planet", [3,0,.5], false));
  expect(await page.locator("#bodies").evaluate((canvas: HTMLCanvasElement) => canvas.width*canvas.height)).toBe(800*560);
  issues.assertClean();
});

test("failed maps and no WebGL retain a visible navigable surface", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  let requests = 0;
  await page.route("**/textures/universe/jupiter.png", (route) => { requests++; return route.fulfill({ contentType: "image/png", body: "unavailable image" }); });
  await installRendererScene(page);
  await page.evaluate(() => (window as any).realism.show("jupiter", "planet"));
  await expect.poll(() => requests).toBe(1);
  expect((await page.evaluate(() => (window as any).realism.pixels())).opaque).toBeGreaterThan(10_000);
  for (let i=0;i<4;i++) await page.evaluate(() => (window as any).realism.render());
  expect(requests).toBe(1);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind: string, ...args: any[]) {
      return kind === "webgl" || kind === "webgl2" ? null : getContext.call(this, kind as any, ...args);
    } as any;
  });
  await installRendererScene(page);
  await page.evaluate(() => (window as any).realism.show("moon", "moon"));
  await expect(page.locator("#bodies")).toHaveAttribute("data-renderer", "canvas");
  await expect(page.locator("#bodies")).toHaveAttribute("data-loaded-textures", /moon.jpg/);
  expect((await page.evaluate(() => (window as any).realism.pixels())).colors).toBeGreaterThan(40);
  await page.evaluate(() => (window as any).realism.show("jupiter", "planet", [1+30/69911,0,0]));
  expect((await page.evaluate(() => (window as any).realism.pixels())).opaque).toBeGreaterThan(400_000);
  expect(errors).toEqual([]);
});
