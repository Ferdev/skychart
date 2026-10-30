import { escapeHtml as h } from "../atlasFormatting";
import { t } from "../i18n";
import { calendarAddress, CALENDAR_EVENT_TYPES, webcalAddress, type CalendarEventType } from "./nowEvents";

/** The `Subscribe` control of the `Happening now` section: the event types, the address, and a calendar link. */
export function bindCalendarSubscribe(root: HTMLDetailsElement): void {
  let types: CalendarEventType[] = [...CALENDAR_EVENT_TYPES];
  const paint = () => {
    const open = root.open;
    const address = calendarAddress(window.location.origin, types);
    root.innerHTML = `<summary>${h(t("now.subscribe"))}</summary>
      <div class="now-subscribe__body">
        <fieldset><legend>${h(t("now.subscribeTypes"))}</legend>
          ${CALENDAR_EVENT_TYPES.map((type) => `<label><input type="checkbox" value="${type}"${types.includes(type) ? " checked" : ""}> ${h(t(`now.type.${type}`))}</label>`).join("")}
        </fieldset>
        <label class="now-subscribe__address">${h(t("now.subscribeAddress"))}<input type="text" readonly value="${h(address)}"></label>
        <div class="now-subscribe__actions"><button type="button" class="secondary-action" data-copy>${h(t("now.subscribeCopy"))}</button><a href="${h(webcalAddress(address))}">${h(t("now.subscribeOpen"))}</a></div>
        <p class="now-subscribe__status" role="status"></p>
      </div>`;
    root.open = open;
    const status = root.querySelector<HTMLElement>("[role='status']")!;
    const field = root.querySelector<HTMLInputElement>("input[readonly]")!;
    field.onfocus = () => field.select();
    root.querySelector<HTMLButtonElement>("[data-copy]")!.onclick = async () => {
      try {
        await navigator.clipboard.writeText(address);
        status.textContent = t("now.subscribeCopied");
      } catch {
        field.focus();
        status.textContent = t("now.subscribeCopyFailed");
      }
    };
    root.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((box) => {
      box.onchange = () => {
        const selected = [...root.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")].map((item) => item.value as CalendarEventType);
        // An empty choice has no calendar. The last type stays selected.
        if (selected.length === 0) {
          box.checked = true;
          return;
        }
        types = selected;
        paint();
        root.querySelector<HTMLInputElement>(`input[value="${box.value}"]`)?.focus();
      };
    });
  };
  paint();
  window.addEventListener("cosmic-atlas:locale-change", paint);
}
