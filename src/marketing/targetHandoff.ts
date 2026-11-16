import { measurementHeaders } from "../analytics";
import { targetListLayer } from "../destination/targetListLayer";
import type { TargetMatchRow } from "../destination/targetList";
const HANDOFF = "cosmic-atlas:target-handoff";
export async function restoreTargetLayer(token: string, select: (key: string) => Promise<unknown>) {
  if (!token) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    let rows: TargetMatchRow[];
    if (token === "local") {
      rows = JSON.parse(sessionStorage.getItem(HANDOFF) ?? "[]") as TargetMatchRow[];
      sessionStorage.removeItem(HANDOFF);
    } else {
      if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error();
      const response = await fetch(`/api/catalog/target-snapshots/${token}`, { headers: measurementHeaders() });
      if (!response.ok) throw new Error();
      rows = (await response.json() as { rows: TargetMatchRow[] }).rows;
    }
    if (!Array.isArray(rows) || rows.length > 500) throw new Error();
    targetListLayer.set(rows);
    const first = rows.find(row => row.status === "matched" && row.object)?.object;
    if (first) await select(first.key);
  } catch {
    const message = document.createElement("p"); message.setAttribute("role", "alert"); message.textContent = "The target list could not be opened. Return to the result page and try again."; document.body.prepend(message);
  }
}
