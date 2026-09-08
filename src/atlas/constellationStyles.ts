import { CONSTELLATIONS } from "../sky/constellations.ts";

// Name-based IDs and colors stay stable when the topology list changes.
export const MAP_CONSTELLATIONS = CONSTELLATIONS.map((figure) => {
  const id = figure.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const hash = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return { ...figure, id, color: `hsl(${(hash % 36000) / 100} 72% 72%)` };
});

const ids = new Set(MAP_CONSTELLATIONS.map((figure) => figure.id));

export function normalizeHiddenConstellations(values: readonly string[]): string[] {
  return [...new Set(values.filter((id) => ids.has(id)))].sort();
}
