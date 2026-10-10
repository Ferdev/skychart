import { escapeHtml } from "../atlasFormatting";
import { NEW_TAB_LINK_ATTRIBUTES } from "../format/links";
import { formatDateTime } from "../format/quantity";
import { t } from "../i18n";
import { uniqueNowEvents, type NowEvent } from "./nowEvents";

type NowPayload = {
  stale: boolean;
  refreshed_at: string | null;
  events: NowEvent[];
};

const MAX_EVENTS = 6;
/** Rows that show before the user selects `Show all`. */
const COLLAPSED_EVENTS = 3;

/** Loads the `Happening now` feed and shows it in the Search panel: three rows, and the others after `Show all`. */
export async function loadNowEvents(status: HTMLElement, list: HTMLElement, showAll: HTMLButtonElement) {
  try {
    const response = await fetch("/api/now");
    if (!response.ok) throw new Error();
    const payload = await response.json() as NowPayload;
    status.textContent = payload.stale
      ? t("launch.eventsCached", { date: payload.refreshed_at ? formatDateTime(payload.refreshed_at) : t("launch.unknown") })
      : t("launch.eventsUpdated", { date: formatDateTime(payload.refreshed_at ?? Date.now()) });
    const events = uniqueNowEvents(payload.events).slice(0, MAX_EVENTS);
    list.innerHTML = events.map(renderNowEvent).join("");
    const setExpanded = (expanded: boolean) => {
      [...list.children].forEach((row, index) => { (row as HTMLElement).hidden = !expanded && index >= COLLAPSED_EVENTS; });
      showAll.setAttribute("aria-expanded", String(expanded));
      showAll.textContent = t(expanded ? "now.showFewer" : "now.showAll");
    };
    showAll.hidden = events.length <= COLLAPSED_EVENTS;
    showAll.onclick = () => setExpanded(showAll.getAttribute("aria-expanded") !== "true");
    setExpanded(false);
    // The button text depends on its state, so the page translation cannot set it.
    window.addEventListener("cosmic-atlas:locale-change", () => setExpanded(showAll.getAttribute("aria-expanded") === "true"));
  } catch {
    status.textContent = t("launch.eventsUnavailable");
    showAll.hidden = true;
  }
}

function renderNowEvent(item: NowEvent) {
  const external = item.catalog_key ? "" : NEW_TAB_LINK_ATTRIBUTES;
  return `<li><a href="${escapeHtml(item.url)}" ${external}>${escapeHtml(item.title)}</a><time datetime="${escapeHtml(item.starts_at)}">${escapeHtml(formatDateTime(item.starts_at, { dateStyle: "medium" }))}</time><p>${escapeHtml(item.summary)}</p></li>`;
}
