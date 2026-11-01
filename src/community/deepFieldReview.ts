import { formatCount, formatFixed } from "../format/quantity";
import { t } from "../i18n";
import { CommunityApi, errorText } from "./api";
import { dateTimeText, emptyState, h } from "./communityUi";

type ReviewBuild = {
  version: number;
  status: string;
  stop: string | null;
  frames_used: number;
  frames_rejected: number;
  limiting_mag: number | null;
  gain_mag: number | null;
  inserted_at: string;
};
type ReviewState = {
  current: { slug: string; title: string; frames: number; builds: ReviewBuild[] } | null;
  candidates: { key: string; name: string; solved_photos: number }[];
};

function buildLine(build: ReviewBuild): string {
  const parts = [
    t("deep.mod.build", { version: build.version }),
    dateTimeText(build.inserted_at),
    build.status === "published" ? t("deep.mod.used", { count: formatCount(build.frames_used) }) : t("deep.mod.stopped"),
    build.frames_rejected ? t("deep.mod.rejected", { count: formatCount(build.frames_rejected) }) : "",
    build.gain_mag === null ? "" : t("deep.gainValue", { value: formatFixed(build.gain_mag, 2) }),
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The `Deep fields` section of the review tools: one open target, its builds, and the next targets. */
export async function paintDeepFields(api: CommunityApi, list: HTMLElement, current: () => boolean, message: (text: string) => void) {
  const state = await api.request<ReviewState>("/api/community/review/deep-fields");
  if (!current()) return;
  const send = async (path: string, body: object, done: string) => {
    try {
      await api.request(path, "POST", body);
      message(done);
      await paintDeepFields(api, list, current, message);
    } catch (error) {
      message(errorText(error));
    }
  };
  const open = state.current;
  const openBlock = open
    ? `<section class="community-section"><h3>${h(t("deep.mod.current", { title: open.title }))}</h3><p class="community-muted">${h(t("deep.mod.frames", { count: formatCount(open.frames) }))}</p>${open.builds.length ? `<ul class="community-log">${open.builds.map((build) => `<li>${h(buildLine(build))}</li>`).join("")}</ul>` : ""}<div class="community-actions community-actions--wrap"><a class="secondary-action" href="/deep-field/${h(open.slug)}">${h(t("deep.title"))}</a><button type="button" class="secondary-action" data-rebuild>${h(t("deep.mod.rebuild"))}</button><button type="button" class="text-action community-danger" data-close-field>${h(t("deep.mod.close"))}</button></div></section>`
    : "";
  const candidates = state.candidates.length
    ? `<ul class="community-own-list">${state.candidates
        .map(
          (candidate) =>
            `<li class="community-own"><div class="community-own__text"><strong>${h(candidate.name)}</strong><span class="community-muted">${h(t("deep.mod.solved", { count: formatCount(candidate.solved_photos) }))}</span></div><div class="community-actions"><button type="button" class="secondary-action" data-open-field="${h(candidate.key)}" ${open ? "disabled" : ""}>${h(t("deep.mod.open"))}</button></div></li>`,
        )
        .join("")}</ul>`
    : emptyState(t("deep.mod.none"));
  list.innerHTML = `${openBlock}<section class="community-section"><h3>${h(t("deep.mod.candidates"))}</h3>${candidates}</section>`;
  list.querySelector<HTMLButtonElement>("[data-rebuild]")?.addEventListener("click", () => void send(`/api/community/deep-fields/${open!.slug}/rebuild`, {}, t("deep.mod.queued")));
  list.querySelector<HTMLButtonElement>("[data-close-field]")?.addEventListener("click", () => void send(`/api/community/deep-fields/${open!.slug}/close`, {}, t("community.mod.done")));
  list.querySelectorAll<HTMLButtonElement>("[data-open-field]").forEach((button) =>
    button.addEventListener("click", () => void send("/api/community/deep-fields", { key: button.dataset.openField }, t("community.mod.done"))),
  );
}
