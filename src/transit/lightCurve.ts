/** The light curve as an SVG drawing: the points, and the fitted model as a line. Pure, so that node tests can import it. */
export type CurveModel = { minutes: number[]; flux: number[] };

const WIDTH = 640;
const HEIGHT = 240;
const PAD = 8;

export function lightCurveSvg(points: [number, number, number][], model: CurveModel | null | undefined, label: string): string {
  if (points.length < 2) return "";
  const times = points.map((point) => point[0]);
  const fluxes = points.map((point) => point[1]).sort((a, b) => a - b);
  const median = fluxes[Math.floor(fluxes.length / 2)]!;
  const first = Math.min(...times);
  const span = Math.max(Math.max(...times) - first, 1e-9);
  const low = fluxes[Math.floor(fluxes.length * 0.01)]! / median;
  const high = fluxes[Math.ceil(fluxes.length * 0.99) - 1]! / median;
  const pad = Math.max((high - low) * 0.1, 1e-4);
  const x = (time: number) => PAD + ((time - first) / span) * (WIDTH - 2 * PAD);
  const y = (flux: number) => PAD + (1 - (flux - low + pad) / (high - low + 2 * pad)) * (HEIGHT - 2 * PAD);
  const dots = points
    .map(([time, flux]) => `<circle cx="${x(time).toFixed(1)}" cy="${Math.min(HEIGHT - 2, Math.max(2, y(flux / median))).toFixed(1)}" r="1.6"/>`)
    .join("");
  let line = "";
  if (model && model.minutes.length > 1) {
    const middle = times[Math.floor(times.length / 2)]!;
    const zero = middle - model.minutes[Math.floor(model.minutes.length / 2)]! / 1440;
    // The fit divides by the same median as the points here, so the model needs no second scale.
    line = `<polyline fill="none" points="${model.minutes.map((minute, index) => `${x(zero + minute / 1440).toFixed(1)},${y(model.flux[index]!).toFixed(1)}`).join(" ")}"/>`;
  }
  return `<svg class="transit-curve" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label.replace(/"/g, "&quot;")}">${dots}${line}</svg>`;
}
