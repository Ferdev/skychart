import { readdir, readFile } from "node:fs/promises"; import { basename, join } from "node:path";
const directory = new URL("../public/tours/", import.meta.url); const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const files = (await readdir(directory)).filter((file) => file.endsWith(".json")); if (files.length < 2) throw new Error("At least two launch tours are required");
for (const file of files) { const tour = JSON.parse(await readFile(join(directory.pathname, file), "utf8"));
 if (!slugPattern.test(tour.slug) || basename(file, ".json") !== tour.slug || typeof tour.title !== "string" || typeof tour.description !== "string" || !Array.isArray(tour.steps) || tour.steps.length < 2) throw new Error(`${file}: invalid schema`);
 tour.steps.forEach((step, index) => { const p = new URLSearchParams(step.viewState); const center = p.get("c")?.split(",").map(Number); const zoom = Number(p.get("z"));
  if (typeof step.title !== "string" || typeof step.body !== "string" || p.get("v") !== "1" || center?.length !== 2 || !center.every(Number.isFinite) || !Number.isFinite(zoom) || zoom <= 0 || !p.get("t") || p.get("L") === null) throw new Error(`${file} step ${index}: invalid`);
  if (step.holdMs !== undefined && (!Number.isInteger(step.holdMs) || step.holdMs < 0 || step.holdMs > 60000)) throw new Error(`${file} step ${index}: invalid holdMs`); }); }
console.log(`Validated ${files.length} tours`);
