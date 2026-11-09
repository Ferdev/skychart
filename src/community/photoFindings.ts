import { formatFixed } from "../format/quantity";
import { t } from "../i18n";
import { CommunityApi, errorText, type Finding, type Photo } from "./api";
import { dateText, h } from "./communityUi";
import { blinkTransform, BLINK_HEIGHT, BLINK_WIDTH, surveyFov } from "./findingBlink";
import type { Wcs } from "./photoFootprint";

export function findingTitle(finding: Pick<Finding, "kind" | "designation">): string {
  return finding.designation ?? t(`finding.kind.${finding.kind}`);
}

export function findingFacts(finding: Finding): string {
  const parts = [
    t(`finding.kind.${finding.kind}`),
    finding.magnitude === null || finding.magnitude === undefined ? "" : t("finding.magnitude", { value: formatFixed(finding.magnitude, 1) }),
    finding.near_name ?? "",
    finding.kind === "known_body" ? t(finding.recovered ? "finding.recovered" : "finding.notRecovered") : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The blink of the photo and the DR11 survey at one place. It changes only when the person presses the button. */
export function blinkMarkup(imageUrl: string, wcs: Wcs, finding: Pick<Finding, "ra_deg" | "dec_deg" | "x" | "y">): string {
  const fov = surveyFov(wcs);
  const url = new URLSearchParams({ provider: "legacy-dr11", ra: String(finding.ra_deg), dec: String(finding.dec_deg), fov: String(fov) });
  return `<div class="finding-blink" data-blink><svg viewBox="0 0 ${BLINK_WIDTH} ${BLINK_HEIGHT}" role="img" aria-label="${h(t("finding.photo"))}"><image class="finding-blink__survey" href="/api/survey-image?${h(url.toString())}" width="${BLINK_WIDTH}" height="${BLINK_HEIGHT}" style="display:none"></image><image class="finding-blink__photo" href="${h(imageUrl)}" width="${wcs.width}" height="${wcs.height}" preserveAspectRatio="none" transform="${h(blinkTransform(wcs, finding.x ?? 0.5, finding.y ?? 0.5, fov))}"></image><circle cx="${BLINK_WIDTH / 2}" cy="${BLINK_HEIGHT / 2}" r="14"></circle></svg><p class="community-credit" data-blink-label>${h(t("finding.photo"))}</p><button type="button" class="secondary-action" data-blink-toggle>${h(t("finding.blink"))}</button></div>`;
}

export function bindBlink(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-blink]").forEach((stage) => {
    const survey = stage.querySelector<SVGImageElement>(".finding-blink__survey")!;
    const photo = stage.querySelector<SVGImageElement>(".finding-blink__photo")!;
    const label = stage.querySelector<HTMLElement>("[data-blink-label]")!;
    stage.querySelector<HTMLButtonElement>("[data-blink-toggle]")!.onclick = () => {
      const showSurvey = survey.style.display === "none";
      survey.style.display = showSurvey ? "" : "none";
      photo.style.display = showSurvey ? "none" : "";
      label.textContent = t(showSurvey ? "finding.survey" : "finding.photo");
    };
  });
}

/** The `Found in this photo` section of the photo viewer. The server gives the private list to the author only. */
export async function mountFindings(api: CommunityApi, root: HTMLElement, stage: HTMLElement, photo: Photo, message: (text: string) => void) {
  let findings: Finding[] = [];
  try {
    findings = (await api.request<{ findings: Finding[] }>(`/api/community/photos/${photo.id}/findings`)).findings;
  } catch {
    return;
  }
  if (!root.isConnected || !findings.length) return;
  for (const finding of findings) {
    if (finding.x === null || finding.y === null || finding.x === undefined || finding.y === undefined) continue;
    const mark = document.createElement("span");
    mark.className = "community-finding-mark";
    mark.dataset.kind = finding.kind;
    mark.style.left = `${finding.x * 100}%`;
    mark.style.top = `${finding.y * 100}%`;
    const title = findingTitle(finding);
    const kind = t(`finding.kind.${finding.kind}`);
    mark.title = title;
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", finding.designation ? `${title} · ${kind}` : kind);
    stage.append(mark);
  }
  const own = api.user?.handle === photo.author.handle;
  const paint = () => {
    root.innerHTML = `<h3>${h(t("finding.title"))}</h3><p class="community-help">${h(t(own ? "finding.ownHelp" : "finding.note"))}</p><ul class="community-findings">${findings
      .map((finding) => {
        const waiting = finding.state === "waiting_second" ? `<p class="community-muted">${h(t("finding.waiting"))}</p>` : finding.state === "review" ? `<p class="community-muted">${h(t("finding.inReview"))}</p>` : "";
        const canShow = own && finding.state !== "approved" && (finding.kind !== "candidate" || finding.state === "reviewed");
        const canHide = own && finding.state === "approved";
        const canDismiss = own && finding.state === "proposed";
        const report = own && finding.report ? `<details><summary>${h(t("finding.report"))}</summary><p class="community-help">${h(t("finding.reportHelp"))}</p><pre class="finding-report">${h(finding.report)}</pre></details>` : "";
        const blink = finding.kind === "candidate" && photo.wcs ? blinkMarkup(photo.image_url, photo.wcs, finding) : "";
        return `<li data-finding="${h(finding.id)}"><strong>${h(findingTitle(finding))}</strong><span class="community-muted">${h(findingFacts(finding))}</span>${waiting}${blink}${report}<div class="community-actions community-actions--wrap">${canShow ? `<button type="button" class="text-action" data-show="true">${h(t("finding.show"))}</button>` : ""}${canHide ? `<button type="button" class="text-action" data-show="false">${h(t("finding.hide"))}</button>` : ""}${canDismiss ? `<button type="button" class="text-action" data-show="false">${h(t("finding.dismiss"))}</button>` : ""}</div></li>`;
      })
      .join("")}</ul>`;
    bindBlink(root);
    root.querySelectorAll<HTMLButtonElement>("[data-show]").forEach((button) => {
      button.onclick = async () => {
        const id = button.closest<HTMLElement>("[data-finding]")!.dataset.finding!;
        try {
          const updated = await api.request<Finding>(`/api/community/findings/${id}/public`, "POST", { show: button.dataset.show === "true" });
          findings = findings.map((item) => (item.id === id ? { ...item, ...updated } : item)).filter((item) => item.state !== "dismissed");
          paint();
        } catch (error) {
          message(errorText(error));
        }
      };
    });
  };
  paint();
}

/** A short list of approved findings, for the object inspector and the page of a photographer. */
export function findingList(findings: Finding[]): string {
  return `<ul class="community-findings">${findings
    .map((finding) => `<li><button type="button" class="community-link" data-finding-photo="${h(finding.photo_id ?? "")}">${h(findingTitle(finding))}</button><span class="community-muted">${h(findingFacts(finding))} · ${h(finding.author?.name ?? "")} · ${h(dateText(finding.captured_at))}</span></li>`)
    .join("")}</ul><p class="community-note">${h(t("finding.note"))}</p>`;
}

/** The approved findings near one object, as a section of the object inspector. It is absent when there are none. */
export async function mountObjectFindings(api: CommunityApi, after: Element, key: string, stale: () => boolean, open: (photoId: string) => void) {
  const { findings } = await api.request<{ findings: Finding[] }>(`/api/objects/${encodeURIComponent(key)}/findings`);
  if (stale() || !findings.length || !after.isConnected) return;
  after.parentElement?.querySelector(":scope > .object-findings")?.remove();
  const node = document.createElement("section");
  node.className = "data-section object-findings";
  node.innerHTML = `<div class="section-heading"><span>${h(t("finding.title"))}</span></div>${findingList(findings)}`;
  node.querySelectorAll<HTMLButtonElement>("[data-finding-photo]").forEach((button) => (button.onclick = () => open(button.dataset.findingPhoto!)));
  after.after(node);
}
