import { trackEvent } from "../analytics";
import { formatCount, formatFixed } from "../format/quantity";
import { t } from "../i18n";
import { CommunityApi, errorText } from "./api";
import { dateText, h, licenceText, openDialog, type DialogView } from "./communityUi";
import { clampView, frameStateKey, panBy, zoomAt, type DeepFieldData, type DeepFieldRow, type DeepFrame, type ImageView } from "./deepFieldModel";

const ZOOM_STEP = 1.5;
const PAN_STEP = 40;

/** The text of the state of a frame in the language of the application. */
export function frameStateText(frame: DeepFrame): string {
  const state = frameStateKey(frame);
  return t(state.key, state.percent === undefined ? {} : { value: formatFixed(state.percent, 1) });
}

/** The page of one deep field: the image with its zoom and slider, the depth map, and the credit wall. */
export class DeepFieldWindow {
  constructor(
    private readonly api: CommunityApi,
    private readonly openObject: (key: string) => void,
    private readonly openPhotographer: (handle: string) => void,
  ) {}

  async open(slug: string) {
    const view = openDialog(t("deep.title"), { variant: "deep-field", eyebrow: t("community.title") });
    trackEvent("deep_field");
    try {
      const field = await this.api.request<DeepFieldData>(`/api/deep-fields/${encodeURIComponent(slug)}`);
      if (view.dialog.isConnected) this.paint(view, field);
    } catch (error) {
      view.message.textContent = errorText(error);
    }
  }

  private paint(view: DialogView, field: DeepFieldData) {
    const title = t("deep.pageTitle", { title: field.title });
    view.dialog.setAttribute("aria-label", title);
    view.header.querySelector("h2")!.textContent = title;
    const build = field.build;
    const notice = field.status === "closed" ? `<p class="community-note">${h(t("deep.closed"))}</p>` : "";
    if (!build) {
      view.body.innerHTML = `<p class="community-note">${h(t("deep.pending"))}</p>${notice}<div class="community-actions"><button type="button" class="text-action" data-open-object>${h(t("community.openObject"))}</button></div>`;
      this.bindObject(view, field);
      return;
    }
    const facts: [string, string][] = [
      [t("deep.fact.frames"), formatCount(build.frames)],
      [t("deep.fact.contributors"), formatCount(field.contributors.length)],
      [t("deep.fact.limit"), build.limiting_mag === null ? "" : formatFixed(build.limiting_mag, 1)],
      [t("deep.fact.gain"), build.gain_mag === null ? "" : t("deep.gainValue", { value: formatFixed(build.gain_mag, 2) })],
      [t("deep.fact.built"), dateText(build.built_at)],
    ];
    const wall = field.contributors
      .map(
        (person) =>
          `<li><button type="button" class="text-action" data-author="${h(person.handle)}">${h(person.name)}</button><span class="community-muted">${h(t("deep.contributor", { count: formatCount(person.frames) }))}</span><ul>${person.photos
            .map((photo) => `<li><a href="/photos/${h(photo.id)}">${h(photo.title)}</a> · ${h(licenceText(photo.licence))}</li>`)
            .join("")}</ul></li>`,
      )
      .join("");
    view.body.innerHTML = `<div class="deep-field"><figure class="deep-field__figure"><div class="deep-field__stage" tabindex="0" role="img" aria-label="${h(title)}" aria-describedby="deep-field-help"><div class="deep-field__image"><img src="${h(build.best_url)}" alt="" draggable="false" data-layer="best"><img src="${h(build.stack_url)}" alt="" draggable="false" data-layer="stack"><img src="${h(build.depth_url)}" alt="" draggable="false" data-layer="depth" hidden></div></div><figcaption id="deep-field-help" class="community-field__help">${h(t("deep.method"))}</figcaption></figure><div class="deep-field__controls"><label class="deep-field__slider"><span class="sr-only">${h(t("deep.slider"))}</span><span aria-hidden="true">${h(t("deep.sliderBest"))}</span><input type="range" min="0" max="100" step="1" value="100" data-blend aria-label="${h(t("deep.slider"))}"><span aria-hidden="true">${h(t("deep.sliderStack"))}</span></label><div class="community-actions community-actions--wrap"><button type="button" class="secondary-action" data-zoom="in">${h(t("deep.zoomIn"))}</button><button type="button" class="secondary-action" data-zoom="out">${h(t("deep.zoomOut"))}</button><button type="button" class="text-action" data-zoom="reset">${h(t("deep.zoomReset"))}</button><button type="button" class="secondary-action" data-depth-map aria-pressed="false">${h(t("deep.depthMap"))}</button></div><p class="community-field__help" data-depth-legend hidden>${h(t("deep.depthLegend", { count: formatCount(build.max_coverage) }))}</p></div><aside class="deep-field__side"><dl class="community-facts">${facts
      .filter(([, value]) => value)
      .map(([label, value]) => `<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`)
      .join("")}</dl>${notice}<section class="community-section"><h3>${h(t("deep.credits"))}</h3><ul class="deep-field__wall">${wall}</ul></section><div class="community-actions"><button type="button" class="text-action" data-open-object>${h(t("community.openObject"))}</button></div></aside></div>`;
    this.bindObject(view, field);
    view.body.querySelectorAll<HTMLButtonElement>("[data-author]").forEach(
      (button) =>
        (button.onclick = () => {
          view.dialog.close();
          this.openPhotographer(button.dataset.author!);
        }),
    );
    this.bindImage(view);
  }

  private bindObject(view: DialogView, field: DeepFieldData) {
    view.body.querySelector<HTMLButtonElement>("[data-open-object]")!.onclick = () => {
      view.dialog.close();
      this.openObject(field.key);
    };
  }

  private bindImage(view: DialogView) {
    const stage = view.body.querySelector<HTMLElement>(".deep-field__stage")!;
    const image = view.body.querySelector<HTMLElement>(".deep-field__image")!;
    const stack = view.body.querySelector<HTMLImageElement>("[data-layer='stack']")!;
    const depth = view.body.querySelector<HTMLImageElement>("[data-layer='depth']")!;
    const legend = view.body.querySelector<HTMLElement>("[data-depth-legend]")!;
    let current: ImageView = { scale: 1, x: 0, y: 0 };
    const apply = (next: ImageView) => {
      current = next;
      image.style.transform = `translate(${next.x}px,${next.y}px) scale(${next.scale})`;
    };
    const zoom = (factor: number, x = stage.clientWidth / 2, y = stage.clientHeight / 2) => apply(zoomAt(current, factor, x, y, stage.clientWidth, stage.clientHeight));
    const pan = (x: number, y: number) => apply(panBy(current, x, y, stage.clientWidth, stage.clientHeight));

    view.body.querySelector<HTMLInputElement>("[data-blend]")!.oninput = (event) => {
      stack.style.opacity = String(Number((event.target as HTMLInputElement).value) / 100);
    };
    const map = view.body.querySelector<HTMLButtonElement>("[data-depth-map]")!;
    map.onclick = () => {
      const shown = map.getAttribute("aria-pressed") !== "true";
      map.setAttribute("aria-pressed", String(shown));
      depth.hidden = !shown;
      legend.hidden = !shown;
    };
    view.body.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(
      (button) =>
        (button.onclick = () => {
          if (button.dataset.zoom === "in") zoom(ZOOM_STEP);
          else if (button.dataset.zoom === "out") zoom(1 / ZOOM_STEP);
          else apply(clampView({ scale: 1, x: 0, y: 0 }, stage.clientWidth, stage.clientHeight));
        }),
    );
    stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const box = stage.getBoundingClientRect();
        zoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX - box.left, event.clientY - box.top);
      },
      { passive: false },
    );
    let drag: { x: number; y: number } | null = null;
    stage.addEventListener("pointerdown", (event) => {
      drag = { x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag) return;
      pan(event.clientX - drag.x, event.clientY - drag.y);
      drag = { x: event.clientX, y: event.clientY };
    });
    stage.addEventListener("pointerup", () => (drag = null));
    stage.addEventListener("pointercancel", () => (drag = null));
    stage.addEventListener("keydown", (event) => {
      const moves: Record<string, () => void> = {
        "+": () => zoom(ZOOM_STEP),
        "=": () => zoom(ZOOM_STEP),
        "-": () => zoom(1 / ZOOM_STEP),
        ArrowLeft: () => pan(PAN_STEP, 0),
        ArrowRight: () => pan(-PAN_STEP, 0),
        ArrowUp: () => pan(0, PAN_STEP),
        ArrowDown: () => pan(0, -PAN_STEP),
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      move();
    });
  }
}

/** The deep field row of the `Community photos` section of the object inspector. */
export function deepFieldRow(row: DeepFieldRow): string {
  const detail = [t("deep.row", { frames: formatCount(row.frames), people: formatCount(row.contributors) }), row.limiting_mag === null ? "" : `${t("deep.fact.limit")} ${formatFixed(row.limiting_mag, 1)}`].filter(Boolean).join(" · ");
  return `<button type="button" class="community-deep-row" data-deep-field="${h(row.slug)}"><img loading="lazy" decoding="async" src="${h(row.thumbnail_url)}" alt=""><span><strong>${h(t("deep.pageTitle", { title: row.title }))}</strong><span class="community-muted">${h(detail)}</span></span></button>`;
}

/** Asks for the consent of the owner. The photo joins only after this dialog. */
export function addFrameDialog(api: CommunityApi, photoId: string, fieldTitle: string, done: (frame: DeepFrame) => void) {
  const view = openDialog(t("deep.addTitle", { title: fieldTitle }), { eyebrow: t("deep.title") });
  view.body.innerHTML = `<form class="community-form"><p class="community-help">${h(t("deep.addText"))}</p><label class="community-check"><input type="checkbox" name="future"><span>${h(t("deep.addFuture"))}</span></label><div class="community-actions"><button class="primary-action">${h(t("deep.add"))}</button></div></form>`;
  view.body.querySelector("form")!.onsubmit = async (event) => {
    event.preventDefault();
    const future = (event.target as HTMLFormElement).future.checked as boolean;
    try {
      const frame = await api.request<DeepFrame>(`/api/community/photos/${photoId}/deep-frame`, "POST", { future });
      view.dialog.close();
      done(frame);
    } catch (error) {
      view.message.textContent = errorText(error);
    }
  };
}

/** The action of a photo in the viewer. Only the owner of the photo sees it. */
export async function mountFrameAction(api: CommunityApi, actions: HTMLElement, photoId: string, message: (text: string) => void) {
  const state = await api.request<{ field: { slug: string; title: string } | null | false; frame: DeepFrame | null }>(`/api/community/photos/${photoId}/deep-frame`);
  const active = state.frame && !state.frame.withdrawn_at ? state.frame : null;
  const field = state.field;
  if (!active && !field) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-action";
  const paint = (frame: DeepFrame | null) => {
    button.textContent = t(frame ? "deep.remove" : "deep.add");
    button.onclick = async () => {
      if (!frame) {
        if (field) addFrameDialog(api, photoId, field.title, (added) => {
          message(t("deep.added"));
          paint(added);
        });
        return;
      }
      try {
        await api.request(`/api/community/photos/${photoId}/deep-frame`, "DELETE", {});
        message(t("deep.removed"));
        if (field) paint(null);
        else button.remove();
      } catch (error) {
        message(errorText(error));
      }
    };
  };
  paint(active);
  actions.append(button);
}
