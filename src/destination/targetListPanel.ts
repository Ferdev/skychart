import { escapeHtml as h } from "../atlasFormatting";
import { openDialog, emptyState, type DialogView } from "../community/communityUi";
import { objectTypeLabel } from "../format/objectTypeLabel";
import { formatCount, formatFixed } from "../format/quantity";
import { t } from "../i18n";
import { matchRequestRow, MAX_TARGET_ROWS, parseTargetList, targetListCsv, type TargetMatchRow } from "./targetList";
import { targetListLayer } from "./targetListLayer";

type MatchPayload = { rows: TargetMatchRow[]; limit: number };

/** The window of a target list: the input, the results, and the export. */
export class TargetListPanel {
  private view: DialogView | null = null;
  private text = "";
  private rows: TargetMatchRow[] = [];

  constructor(private readonly options: { selectObject: (key: string) => void }) {
    window.addEventListener("cosmic-atlas:locale-change", () => {
      if (this.view?.dialog.isConnected) this.paint();
    });
  }

  open() {
    if (this.view?.dialog.isConnected) return;
    this.view = openDialog(t("targetList.title"), { variant: "planner", eyebrow: t("targetList.eyebrow") });
    this.view.dialog.addEventListener("close", () => (this.view = null));
    this.paint();
  }

  private paint() {
    const view = this.view!;
    view.dialog.setAttribute("aria-label", t("targetList.title"));
    view.header.querySelector("h2")!.textContent = t("targetList.title");
    view.header.querySelector(".eyebrow")!.textContent = t("targetList.eyebrow");
    view.body.innerHTML = `<form class="community-form target-list-form">
      <p class="community-help">${h(t("targetList.help", { limit: formatCount(MAX_TARGET_ROWS) }))}</p>
      <label class="community-field"><span>${h(t("targetList.paste"))}</span><textarea name="list" rows="6" spellcheck="false" placeholder="M 31&#10;NGC 7000&#10;05:35:17 -05:23:28&#10;83.82 -5.39">${h(this.text)}</textarea></label>
      <label class="community-field"><span>${h(t("targetList.file"))}</span><input type="file" name="file" accept=".txt,.csv,.tsv,text/plain,text/csv"></label>
      <div class="community-actions community-actions--wrap"><button type="submit" class="primary-action">${h(t("targetList.match"))}</button></div>
    </form><div class="target-list-results"></div>`;
    const form = view.body.querySelector("form")!;
    const list = form.elements.namedItem("list") as HTMLTextAreaElement;
    list.oninput = () => (this.text = list.value);
    (form.elements.namedItem("file") as HTMLInputElement).onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      this.text = await file.text();
      list.value = this.text;
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      void this.submit();
    };
    this.paintResults();
  }

  private async submit() {
    const message = this.view!.message;
    const parsed = parseTargetList(this.text);
    if (parsed.total === 0) {
      message.textContent = t("targetList.empty");
      return;
    }
    if (parsed.total > MAX_TARGET_ROWS) {
      message.textContent = t("targetList.tooMany", { count: formatCount(parsed.total), limit: formatCount(MAX_TARGET_ROWS) });
      return;
    }
    message.textContent = t("targetList.matching", { count: formatCount(parsed.total) });
    try {
      const payload = await this.request(parsed.rows.map(matchRequestRow));
      // A position row shows the text of the list, not the numbers of the request.
      this.rows = payload.rows.map((row, index) => ({ ...row, input: parsed.rows[index]!.input }));
      message.textContent = "";
      this.changed();
    } catch (error) {
      message.textContent = (error as Error).message;
    }
  }

  private async request(rows: Record<string, string | number>[]): Promise<MatchPayload> {
    const response = await fetch("/api/catalog/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    if (response.status === 413) throw new Error(t("targetList.tooMany", { count: formatCount(rows.length), limit: formatCount(MAX_TARGET_ROWS) }));
    if (response.status === 429) throw new Error(t("targetList.rateLimited"));
    if (!response.ok) throw new Error(t("targetList.unavailable"));
    return response.json() as Promise<MatchPayload>;
  }

  /** A correction sends one row, and that row gets the new result. */
  private async correct(index: number, row: Record<string, string | number>) {
    const message = this.view?.message;
    try {
      const [result] = (await this.request([row])).rows;
      const input = this.rows[index]!.input;
      this.rows[index] = { ...result!, input };
      this.changed();
    } catch (error) {
      if (message) message.textContent = (error as Error).message;
    }
  }

  private changed() {
    targetListLayer.set(this.rows);
    this.paintResults();
  }

  private paintResults() {
    const root = this.view?.body.querySelector<HTMLElement>(".target-list-results");
    if (!root) return;
    if (!this.rows.length) {
      root.innerHTML = emptyState(t("targetList.prompt"));
      return;
    }
    const count = (status: string) => this.rows.filter((row) => row.status === status).length;
    root.innerHTML = `<p class="planner-summary">${h(t("targetList.summary", { matched: formatCount(count("matched")), ambiguous: formatCount(count("ambiguous")), unmatched: formatCount(count("unmatched")) }))}</p>
      <div class="community-table-wrap"><table class="community-table target-list-table"><thead><tr><th scope="col">${h(t("targetList.col.input"))}</th><th scope="col">${h(t("targetList.col.status"))}</th><th scope="col">${h(t("targetList.col.match"))}</th><th scope="col">${h(t("targetList.col.separation"))}</th><th scope="col">${h(t("targetList.col.source"))}</th></tr></thead><tbody>${this.rows.map((row, index) => this.row(row, index)).join("")}</tbody></table></div>
      <div class="community-actions community-actions--wrap"><button type="button" class="secondary-action" data-export>${h(t("targetList.export"))}</button><button type="button" class="text-action" data-clear>${h(t("targetList.clear"))}</button></div>
      <p class="community-help">${h(t("targetList.layerNote"))}</p>`;
    root.querySelector<HTMLButtonElement>("[data-export]")!.onclick = () => this.download();
    root.querySelector<HTMLButtonElement>("[data-clear]")!.onclick = () => {
      this.rows = [];
      this.changed();
    };
    root.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((button) => {
      button.onclick = () => {
        this.view?.dialog.close();
        this.options.selectObject(button.dataset.select!);
      };
    });
    root.querySelectorAll<HTMLSelectElement>("[data-choose]").forEach((select) => {
      select.onchange = () => {
        if (select.value) void this.correct(Number(select.dataset.choose), { key: select.value });
      };
    });
    root.querySelectorAll<HTMLFormElement>("[data-retry]").forEach((form) => {
      form.onsubmit = (event) => {
        event.preventDefault();
        const name = String(new FormData(form).get("name")).trim();
        if (name) void this.correct(Number(form.dataset.retry), { name });
      };
    });
  }

  private row(row: TargetMatchRow, index: number) {
    const status = `<span class="community-status" data-status="${row.status === "matched" ? "published" : row.status === "ambiguous" ? "review" : "rejected"}">${h(t(`targetList.status.${row.status}`))}</span>`;
    const separation = row.separation_arcsec === undefined || row.separation_arcsec === null ? "" : t("targetList.arcsec", { value: formatFixed(row.separation_arcsec, 1) });
    const duplicate = row.duplicate_of === undefined || row.duplicate_of === null ? "" : `<br><small>${h(t("targetList.duplicate", { row: formatCount(row.duplicate_of + 1) }))}</small>`;
    let match = "";
    if (row.status === "matched" && row.object) {
      match = `<button type="button" class="text-action" data-select="${h(row.object.key)}">${h(row.object.name)}</button><br><small>${h(objectTypeLabel(row.object.object_type, "one"))}</small>${duplicate}`;
    } else if (row.status === "ambiguous") {
      match = `<select data-choose="${index}" aria-label="${h(t("targetList.choose", { input: row.input }))}"><option value="">${h(t("targetList.choosePrompt"))}</option>${(row.candidates ?? []).map((candidate) => `<option value="${h(candidate.key)}">${h(candidate.name)}</option>`).join("")}</select>`;
    } else {
      match = `<form data-retry="${index}" class="target-list-retry"><input name="name" aria-label="${h(t("targetList.correct", { input: row.input }))}" value="${h(row.input)}"><button type="submit" class="text-action">${h(t("targetList.retry"))}</button></form>`;
    }
    return `<tr><td>${h(row.input)}</td><td>${status}</td><td>${match}</td><td>${h(separation)}</td><td>${h(row.object?.source?.label ?? row.object?.catalog_group ?? "")}</td></tr>`;
  }

  private download() {
    const url = URL.createObjectURL(new Blob([targetListCsv(this.rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cosmic-atlas-target-list.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
}
