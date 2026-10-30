import { formatCount } from "../format/quantity";
import { t } from "../i18n";
import type { Tour, TourStep } from "../tourPlayer";
import { errorText, type CommunityApi, type OwnTour } from "./api";
import { emptyState, h, statusBadge } from "./communityUi";
import type { PhotoDialogs } from "./photoDialogs";
import { MAX_TOUR_STEPS, moveStep, stepViewKey } from "./tourSteps";

export type TourBuilderHost = {
  /** The state of the atlas view, in the format of a shared address. */
  captureView: (() => string) | null;
  preview: ((tour: Tour) => void) | null;
};

type Context = {
  api: CommunityApi;
  dialogs: PhotoDialogs;
  host: TourBuilderHost;
  current: () => boolean;
  message: (text: string) => void;
  close: () => void;
  repaint: () => void;
};

type Draft = { id: string | null; url: string | null; title: string; description: string; steps: TourStep[] };

/** The tour in the editor. It stays when the window closes, so that the user can move the map and add a step. */
let draft: Draft | null = null;

/** The tab of the tour builder in the community window. */
export async function renderTourBuilder(panel: HTMLElement, context: Context) {
  if (!context.api.user) {
    panel.innerHTML = `${emptyState(t("community.tours.signIn"))}<div class="community-actions"><button type="button" class="primary-action" data-login>${h(t("community.signIn"))}</button></div>`;
    panel.querySelector<HTMLButtonElement>("[data-login]")!.onclick = () => context.dialogs.login(context.repaint);
    return;
  }
  if (draft) paintEditor(panel, context);
  else await paintList(panel, context);
}

async function paintList(panel: HTMLElement, context: Context) {
  panel.innerHTML = `<div class="community-toolbar"><p class="community-help">${h(t("community.tours.intro"))}</p><button type="button" class="primary-action" data-new>${h(t("community.tours.new"))}</button></div><div class="tour-builder__list" aria-busy="true"></div>`;
  panel.querySelector<HTMLButtonElement>("[data-new]")!.onclick = () => {
    draft = { id: null, url: null, title: "", description: "", steps: [] };
    paintEditor(panel, context);
  };
  const list = panel.querySelector<HTMLElement>(".tour-builder__list")!;
  const { tours } = await context.api.request<{ tours: OwnTour[] }>("/api/community/tours");
  if (!context.current()) return;
  list.removeAttribute("aria-busy");
  if (!tours.length) {
    list.innerHTML = emptyState(t("community.tours.empty"));
    return;
  }
  list.innerHTML = tours
    .map(
      (tour, index) =>
        `<article class="tour-builder__row"><div><strong>${h(tour.title)}</strong> ${tourStatus(tour.status)}<p class="community-muted">${h(t("community.tours.stepCount", { count: formatCount(tour.steps.length) }))}</p>${tour.moderation_reason ? `<p class="community-note community-note--warning">${h(tour.moderation_reason)}</p>` : ""}</div><div class="community-actions community-actions--wrap"><button type="button" class="secondary-action" data-edit="${index}">${h(t("community.tours.edit"))}</button><button type="button" class="text-action" data-copy="${index}">${h(t("community.tours.copyLink"))}</button><button type="button" class="text-action" data-delete="${index}">${h(t("community.tours.delete"))}</button></div></article>`,
    )
    .join("");
  const bind = (name: string, action: (tour: OwnTour) => void) =>
    list.querySelectorAll<HTMLButtonElement>(`[data-${name}]`).forEach((button) => {
      button.onclick = () => action(tours[Number(button.getAttribute(`data-${name}`))]!);
    });
  bind("edit", (tour) => {
    draft = { id: tour.id, url: tour.url, title: tour.title, description: tour.description, steps: tour.steps.map((step) => ({ ...step })) };
    paintEditor(panel, context);
  });
  bind("copy", (tour) => void copyLink(tour.url, context));
  bind("delete", (tour) => {
    if (!window.confirm(t("community.tours.deleteConfirm", { title: tour.title }))) return;
    void context.api.request(`/api/community/tours/${tour.id}`, "DELETE").then(
      () => paintList(panel, context),
      (error) => context.message(errorText(error)),
    );
  });
}

function tourStatus(status: string): string {
  return status === "shared" ? "" : statusBadge(status === "held" ? "review" : "hidden");
}

async function copyLink(url: string, context: Context) {
  try {
    await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
    context.message(t("community.tours.linkCopied"));
  } catch {
    context.message(new URL(url, window.location.origin).toString());
  }
}

function paintEditor(panel: HTMLElement, context: Context) {
  const tour = draft!;
  const full = tour.steps.length >= MAX_TOUR_STEPS;
  panel.innerHTML = `<form class="community-form tour-builder">
    <p class="community-help">${h(t("community.tours.help"))}</p>
    <label class="community-field"><span>${h(t("community.tours.title"))}</span><input name="title" maxlength="120" required value="${h(tour.title)}"></label>
    <label class="community-field"><span>${h(t("community.tours.description"))}</span><textarea name="description" maxlength="500" rows="2">${h(tour.description)}</textarea></label>
    <ol class="tour-builder__steps">${tour.steps
      .map(
        (step, index) => `<li class="tour-builder__step" data-step="${index}">
        <p class="community-muted">${h(t("community.tours.stepLabel", { step: formatCount(index + 1), view: t(stepViewKey(step.viewState)) }))}</p>
        <label class="community-field"><span>${h(t("community.tours.stepTitle"))}</span><input data-field="title" maxlength="120" value="${h(step.title)}"></label>
        <label class="community-field"><span>${h(t("community.tours.caption"))}</span><textarea data-field="body" maxlength="2000" rows="3">${h(step.body)}</textarea></label>
        <div class="community-actions community-actions--wrap"><button type="button" class="text-action" data-move="-1"${index === 0 ? " disabled" : ""}>${h(t("community.tours.up"))}</button><button type="button" class="text-action" data-move="1"${index === tour.steps.length - 1 ? " disabled" : ""}>${h(t("community.tours.down"))}</button><button type="button" class="text-action" data-recapture>${h(t("community.tours.useView"))}</button><button type="button" class="text-action" data-remove>${h(t("community.tours.removeStep"))}</button></div>
      </li>`,
      )
      .join("")}</ol>
    ${tour.steps.length ? "" : emptyState(t("community.tours.noSteps"))}
    <div class="community-actions community-actions--wrap">
      <button type="button" class="secondary-action" data-add${full ? " disabled" : ""}>${h(t("community.tours.addStep"))}</button>
      <button type="button" class="text-action" data-map>${h(t("community.tours.toMap"))}</button>
    </div>
    <div class="community-actions community-actions--wrap">
      <button type="submit" class="primary-action">${h(t("community.tours.save"))}</button>
      <button type="button" class="secondary-action" data-preview${tour.steps.length ? "" : " disabled"}>${h(t("community.tours.preview"))}</button>
      <button type="button" class="secondary-action" data-link${tour.url ? "" : " hidden"}>${h(t("community.tours.copyLink"))}</button>
      <button type="button" class="text-action" data-back>${h(t("community.tours.back"))}</button>
    </div>
  </form>`;
  const form = panel.querySelector("form")!;
  (form.elements.namedItem("title") as HTMLInputElement).oninput = (event) => (tour.title = (event.target as HTMLInputElement).value);
  (form.elements.namedItem("description") as HTMLTextAreaElement).oninput = (event) => (tour.description = (event.target as HTMLTextAreaElement).value);
  form.querySelectorAll<HTMLElement>("[data-step]").forEach((row) => {
    const index = Number(row.dataset.step);
    const step = tour.steps[index]!;
    row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]").forEach((field) => {
      field.oninput = () => (step[field.dataset.field as "title" | "body"] = field.value);
    });
    row.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => {
      button.onclick = () => {
        tour.steps = moveStep(tour.steps, index, Number(button.dataset.move) as -1 | 1);
        paintEditor(panel, context);
      };
    });
    row.querySelector<HTMLButtonElement>("[data-recapture]")!.onclick = () => {
      const view = context.host.captureView?.();
      if (view) step.viewState = view;
      paintEditor(panel, context);
    };
    row.querySelector<HTMLButtonElement>("[data-remove]")!.onclick = () => {
      tour.steps.splice(index, 1);
      paintEditor(panel, context);
    };
  });
  form.querySelector<HTMLButtonElement>("[data-add]")!.onclick = () => {
    const view = context.host.captureView?.();
    if (!view || tour.steps.length >= MAX_TOUR_STEPS) return;
    tour.steps.push({ viewState: view, title: "", body: "" });
    paintEditor(panel, context);
    panel.querySelector<HTMLInputElement>(`[data-step="${tour.steps.length - 1}"] [data-field="title"]`)?.focus();
  };
  form.querySelector<HTMLButtonElement>("[data-map]")!.onclick = () => context.close();
  form.querySelector<HTMLButtonElement>("[data-back]")!.onclick = () => {
    draft = null;
    void paintList(panel, context);
  };
  form.querySelector<HTMLButtonElement>("[data-preview]")!.onclick = () => {
    context.close();
    context.host.preview?.({ slug: "preview", title: tour.title, description: tour.description, steps: tour.steps.map((step) => ({ ...step })) });
  };
  form.querySelector<HTMLButtonElement>("[data-link]")!.onclick = () => void copyLink(tour.url!, context);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const body = { title: tour.title, description: tour.description, steps: tour.steps };
    try {
      const saved = await context.api.request<OwnTour>(tour.id ? `/api/community/tours/${tour.id}` : "/api/community/tours", tour.id ? "PATCH" : "POST", body);
      tour.id = saved.id;
      tour.url = saved.url;
      if (!context.current()) return;
      form.querySelector<HTMLButtonElement>("[data-link]")!.hidden = false;
      context.message(t("community.tours.saved"));
    } catch (error) {
      context.message(errorText(error));
    }
  };
}
