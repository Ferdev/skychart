import { escapeHtml as h } from "../atlasFormatting";
import { formatCount, formatDateTime } from "../format/quantity";
import { t } from "../i18n";
import type { Photo } from "./api";

/** Parts of a community window: the dialog, the area for the content, and the status line. */
export type DialogView = {
  dialog: HTMLDialogElement;
  header: HTMLElement;
  body: HTMLElement;
  message: HTMLElement;
};

/**
 * Opens a modal window with the header of the atlas panels: a small label, the title, and the close button.
 * The window is in `#app`, so that its controls get the base look of the interface (docs/ui-style.md).
 */
export function openDialog(title: string, options: { eyebrow?: string; variant?: string } = {}): DialogView {
  const dialog = document.createElement("dialog");
  dialog.className = `community-dialog${options.variant ? ` community-dialog--${options.variant}` : ""}`;
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `<header class="community-dialog__header"><div class="community-dialog__title"><p class="eyebrow">${h(options.eyebrow ?? t("community.title"))}</p><h2>${h(title)}</h2></div><button type="button" class="icon-button" data-close aria-label="${h(t("community.close"))}">×</button></header><div class="community-dialog__body"></div><p role="status" class="community-message"></p>`;
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  // A click on the backdrop closes the window, as the other popovers of the atlas do.
  // The press must start on the backdrop also, so that a text selection that ends there does not close a form.
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => (pressedBackdrop = event.target === dialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && pressedBackdrop) dialog.close();
  });
  (document.querySelector("#app") ?? document.body).append(dialog);
  dialog.showModal();
  return {
    dialog,
    header: dialog.querySelector<HTMLElement>(".community-dialog__header")!,
    body: dialog.querySelector<HTMLElement>(".community-dialog__body")!,
    message: dialog.querySelector<HTMLElement>(".community-message")!,
  };
}

/** A calendar date in the application language. */
export function dateText(value: string | undefined | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : formatDateTime(date, { dateStyle: "medium", timeZone: "UTC" });
}

/** A date and a time in UTC, for the review tools. */
export function dateTimeText(value: string | undefined | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${formatDateTime(date, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

/** The licence name. Only the name that is not a Creative Commons name has a translation. */
export function licenceText(licence: string): string {
  return licence === "All rights reserved" ? t("community.licence.reserved") : licence;
}

/** The count of appreciations with a star, and the full text for assistive technology. */
export function votesMarkup(count: number): string {
  return `<span class="community-votes" title="${h(t("community.votes", { count: formatCount(count) }))}"><span aria-hidden="true">★ ${h(formatCount(count))}</span><span class="sr-only">${h(t("community.votes", { count: formatCount(count) }))}</span></span>`;
}

/**
 * A photo card. A list of all objects shows the object name; the gallery of one object shows the photographer only.
 */
export function photoCard(photo: Photo, options: { rank?: number; object?: boolean } = {}): string {
  const subject = options.object && photo.object_name ? `${photo.object_name} · ` : "";
  return `<button type="button" class="community-card" data-photo="${h(photo.id)}"><span class="community-card__image"><img loading="lazy" decoding="async" src="${h(photo.thumbnail_url)}" alt="${h(photo.title)}">${options.rank ? `<span class="community-card__rank" aria-label="${h(t("community.rank", { rank: options.rank }))}">${options.rank}</span>` : ""}</span><span class="community-card__row"><span class="community-card__title">${h(photo.title)}</span>${votesMarkup(photo.votes ?? 0)}</span><span class="community-card__meta">${h(subject)}${h(photo.author.name)}</span><span class="community-card__meta">${h(licenceText(photo.licence))} · ${h(dateText(photo.captured_at))}</span></button>`;
}

/** The status of a photo as a small label. */
export function statusBadge(status: string): string {
  const known = ["uploading", "processing", "review", "published", "rejected", "hidden", "failed"].includes(status);
  return `<span class="community-status" data-status="${h(status)}">${h(known ? t(`community.status.${status}`) : status)}</span>`;
}

/** A block of text for a list that has no content. */
export function emptyState(text: string, more = ""): string {
  return `<div class="community-empty"><p>${h(text)}</p>${more ? `<p>${h(more)}</p>` : ""}</div>`;
}

/** A row of buttons of which one is selected (`aria-pressed`). */
export function segmented(label: string, name: string, options: { value: string; label: string; count?: number }[], selected: string): string {
  return `<div class="community-segmented" role="group" aria-label="${h(label)}">${options
    .map(
      (option) =>
        `<button type="button" class="secondary-action" data-${name}="${h(option.value)}" aria-pressed="${option.value === selected}">${h(option.label)}${option.count === undefined ? "" : ` <span class="community-count">${h(formatCount(option.count))}</span>`}</button>`,
    )
    .join("")}</div>`;
}

export { h };
