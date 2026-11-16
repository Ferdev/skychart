import { escapeHtml as h } from "../atlasFormatting";
import { parseTargetList, matchRequestRow, MAX_TARGET_ROWS, targetListCsv, type TargetMatchRow } from "../destination/targetList";
import { trackAnalytics, measurementHeaders } from "../analytics";
import { t } from "../i18n";

type Match = { rows: TargetMatchRow[]; receipt: string };
type Snapshot = { rows: TargetMatchRow[]; catalog_revision: string; created_at: string; revision_note: string };
export const TARGET_HANDOFF = "cosmic-atlas:target-handoff";
const safeUrl = (url: string | undefined) => url && /^https?:\/\//.test(url) ? url : null;
export async function requestMatch(rows: Record<string, unknown>[], signal?: AbortSignal): Promise<Match> {
  const response = await fetch("/api/catalog/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }), signal });
  if (!response.ok) throw new Error(response.status === 429 ? "Too many requests. Try again later." : "The catalog match is unavailable.");
  return response.json() as Promise<Match>;
}
export function mountTargets() {
  const root = document.querySelector<HTMLElement>("#targets")!;
  const token = /^\/targets\/r\/([A-Za-z0-9_-]{32})$/.exec(location.pathname)?.[1];
  const isShared = location.pathname.startsWith("/targets/r/");
  root.innerHTML = `${isShared ? "" : `<form><label>Names or RA and Dec<textarea name="list" maxlength="100000" placeholder="M31&#10;NGC 224&#10;10.6847 41.2687" required></textarea></label><label>Or upload a text or CSV file<input type="file" accept=".txt,.csv,.tsv" data-upload></label><button>${h(t("targetList.match"))}</button></form>`}<p role="status"></p><div data-results></div><p data-share-result></p>`;
  const status = root.querySelector<HTMLElement>("[role=status]")!;
  const results = root.querySelector<HTMLElement>("[data-results]")!;
  const shareResult = root.querySelector<HTMLElement>("[data-share-result]")!;
  let rows: TargetMatchRow[] = [], receipt = "";
  let selections: Record<string, string> = {};
  let generation = 0;
  let controller: AbortController | undefined;
  const unavailable = new Set<string>();
  function paint() {
    results.innerHTML = `<div class="table-scroll" tabindex="0" role="region" aria-label="Match results. Scroll horizontally to read all columns."><table><caption>${rows.length} result rows</caption><thead><tr><th>Input</th><th>Status</th><th>Match</th><th>Source</th></tr></thead><tbody>${rows.map((row, index) => {
      const source = row.object?.source;
      const url = safeUrl(source?.url);
      return `<tr><td>${h(row.input)}</td><td>${h(row.status)}${row.duplicate_of == null ? "" : `<br>Duplicate of row ${row.duplicate_of + 1}`}</td><td>${row.object ? `<a href="/o/${encodeURIComponent(row.object.key)}">${h(row.object.name)}</a>${unavailable.has(row.object.key) ? "<p>Unavailable in the current catalog. The saved facts remain below and in the CSV.</p>" : ""}` : row.status === "ambiguous" && !isShared ? `<select data-choice="${index}" aria-label="Choose match for ${h(row.input)}"><option value="">Choose a candidate</option>${(row.candidates ?? []).map(candidate => `<option value="${h(candidate.key)}">${h(candidate.name)}</option>`).join("")}</select>` : h(row.candidates?.map(candidate => candidate.name).join(", ") ?? "No match")}</td><td>${url ? `<a href="${h(url)}" rel="noreferrer">${h(source?.label ?? "Source record")}</a>` : h(source?.label ?? row.object?.catalog_group ?? "")}</td></tr>`;
    }).join("")}</tbody></table></div><button data-export>Download sourced CSV</button><button data-copy>Copy CSV</button><button data-map>Open matches on the map</button>${isShared ? "" : `<p>Share only when ready. Anyone with the link can read these rows. Shared results do not expire. The upload file and your site are not stored.</p><button data-save>Create share link</button>`}`;
    results.querySelectorAll<HTMLSelectElement>("[data-choice]").forEach(select => select.onchange = async () => {
      if (!select.value) return;
      const own = generation; const index = Number(select.dataset.choice);
      results.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button,select").forEach(control => control.disabled = true);
      try {
        const match = await requestMatch([{ key: select.value }]);
        if (own !== generation) return;
        if (match.rows[0]?.status !== "matched") throw new Error("That candidate is no longer available. Match the list again.");
        rows[index] = { ...match.rows[0], input: rows[index]!.input };
        selections[String(index)] = match.receipt;
        // Recalculate duplicates after a deliberate choice, retaining original row order.
        const seen = new Map<string, number>();
        rows = rows.map((row, i) => {
          const key = row.identity_key ?? row.object?.key; const { duplicate_of: _old, ...clean } = row;
          if (!key) return clean;
          if (seen.has(key)) return { ...clean, duplicate_of: seen.get(key) };
          seen.set(key, i); return clean;
        });
        paint();
      } catch (error) { if (own === generation) { status.textContent = (error as Error).message; paint(); } }
    });
    results.querySelector<HTMLButtonElement>("[data-export]")!.onclick = () => {
      const url = URL.createObjectURL(new Blob([targetListCsv(rows)], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = "cosmic-atlas-target-list.csv"; a.click(); URL.revokeObjectURL(url);
      trackAnalytics("data_export", { source: "targets", format: "csv" });
    };
    results.querySelector<HTMLButtonElement>("[data-copy]")!.onclick = async () => {
      try { await navigator.clipboard.writeText(targetListCsv(rows)); status.textContent = "CSV copied."; trackAnalytics("data_export", { source: "targets", format: "clipboard" }); }
      catch { status.textContent = "Clipboard is unavailable. Use Download sourced CSV."; }
    };
    results.querySelector<HTMLButtonElement>("[data-map]")!.onclick = () => {
      try {
        if (!token) sessionStorage.setItem(TARGET_HANDOFF, JSON.stringify(rows));
        trackAnalytics("cross_tool", { source: "targets", tool: "atlas" });
        location.assign(`/#targets=${token ?? "local"}`);
      } catch { status.textContent = "Browser storage is unavailable. Create a share link to open these matches on the map."; }
    };
    const save = results.querySelector<HTMLButtonElement>("[data-save]");
    if (save) save.onclick = async () => {
      save.disabled = true; const own = generation;
      try {
        const response = await fetch("/api/catalog/target-snapshots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt, selections }) });
        if (!response.ok) throw new Error(response.status === 507 ? "Share storage is full. Matching and CSV still work." : "Sharing is unavailable or the match has expired. Match again before sharing.");
        const result = await response.json() as { url: string };
        if (own !== generation) return;
        shareResult.innerHTML = `<a href="${h(result.url)}">${h(location.origin + result.url)}</a>`;
        trackAnalytics("share", { source: "targets", tool: "snapshot" });
      } catch (error) { if (own === generation) { status.textContent = (error as Error).message; save.disabled = false; } }
    };
  }
  if (isShared) {
    if (!token) { status.textContent = "Shared result not found."; return; }
    void fetch(`/api/catalog/target-snapshots/${token}`, { headers: measurementHeaders() }).then(async response => {
      if (!response.ok) throw new Error("Shared result is unavailable.");
      const snapshot = await response.json() as Snapshot;
      rows = snapshot.rows;
      status.textContent = `Saved ${snapshot.created_at}. ${snapshot.catalog_revision}. ${snapshot.revision_note}`;
      paint();
      const keys = rows.flatMap(row => row.object ? [{ key: row.object.key }] : []);
      if (keys.length) {
        try {
          const current = await requestMatch(keys);
          current.rows.forEach((row, i) => { if (row.status !== "matched") unavailable.add(keys[i]!.key); });
          paint();
        } catch { status.textContent += " Current catalog availability could not be checked. These are the saved results."; }
      }
    }).catch(error => { status.textContent = (error as Error).message; });
    return;
  }
  const form = root.querySelector<HTMLFormElement>("form")!;
  const text = form.elements.namedItem("list") as HTMLTextAreaElement;
  const invalidate = () => { generation++; controller?.abort(); results.replaceChildren(); shareResult.replaceChildren(); rows = []; receipt = ""; selections = {}; };
  text.oninput = invalidate;
  root.querySelector<HTMLInputElement>("[data-upload]")!.onchange = async event => {
    invalidate(); const own = generation;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 100000) { status.textContent = "File is too large. Maximum: 100,000 bytes."; return; }
    const content = await file.text(); if (own === generation) text.value = content;
  };
  form.onsubmit = async event => {
    event.preventDefault(); invalidate(); const own = generation;
    const parsed = parseTargetList(text.value);
    if (!parsed.total || parsed.total > MAX_TARGET_ROWS) { status.textContent = "Enter between 1 and 500 rows."; return; }
    controller = new AbortController(); status.textContent = "Matching…";
    try {
      const result = await requestMatch(parsed.rows.map(matchRequestRow), controller.signal);
      if (own !== generation) return;
      rows = result.rows; receipt = result.receipt; status.textContent = "Match complete. Check each row before sharing."; paint();
      trackAnalytics("calculation_completed", { source: "targets", tool: "match" });
    } catch (error) { if (own === generation) status.textContent = (error as Error).message; }
  };
  window.addEventListener("pagehide", invalidate);
}
