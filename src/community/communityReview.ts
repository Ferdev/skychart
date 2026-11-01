import { formatCount, formatFixed } from "../format/quantity";
import { NEW_TAB_LINK_ATTRIBUTES } from "../format/links";
import { t } from "../i18n";
import { lightCurveSvg } from "../transit/lightCurve";
import { CommunityApi, errorText, type ReviewAction, type ReviewFinding, type ReviewPhoto, type ReviewQueue, type ReviewTour, type ReviewTransit } from "./api";
import { dateText, dateTimeText, emptyState, h, licenceText, segmented, statusBadge } from "./communityUi";
import type { PhotoDialogs } from "./photoDialogs";
import { bindBlink, blinkMarkup, findingFacts, findingTitle } from "./photoFindings";

export type ReviewContext = {
  api: CommunityApi;
  dialogs: PhotoDialogs;
  /** False when the user opened a different tab, so that a late response is ignored. */
  current: () => boolean;
  message: (text: string) => void;
  /** A decision is saved: the public data and the counts are out of date. */
  changed: () => Promise<void>;
};

type Section = "review" | "reports" | "tours" | "transits" | "findings" | "published" | "hidden" | "rejected" | "log" | "members";

const PRESETS = ["notAstro", "wrongObject", "rights", "synthetic", "quality"];
/** The section stays selected while the community window is open and closed again. */
let section: Section = "review";

/**
 * The review tools of a moderator: the photos that wait for a decision, the open reports,
 * the photos of each status, the record of decisions, and the account actions.
 */
export async function renderReview(panel: HTMLElement, context: ReviewContext) {
  const { api } = context;
  panel.innerHTML = `<p class="community-help">${h(t("community.mod.intro"))}</p><div data-sections></div><div class="community-review" data-list aria-busy="true"></div>`;
  const sections = panel.querySelector<HTMLElement>("[data-sections]")!;
  const list = panel.querySelector<HTMLElement>("[data-list]")!;
  let counts: Record<string, number> = {};

  const paintSections = () => {
    sections.innerHTML = segmented(
      t("community.mod.sections"),
      "section",
      [
        { value: "review", label: t("community.mod.waiting"), count: counts.review ?? 0 },
        { value: "reports", label: t("community.mod.reports"), count: counts.reports ?? 0 },
        { value: "tours", label: t("community.tab.tours"), count: counts.tours ?? 0 },
        { value: "transits", label: t("transit.tab.transits"), count: counts.transits ?? 0 },
        { value: "findings", label: t("finding.mod.section"), count: counts.findings ?? 0 },
        { value: "published", label: t("community.status.published"), count: counts.published ?? 0 },
        { value: "hidden", label: t("community.status.hidden"), count: counts.hidden ?? 0 },
        { value: "rejected", label: t("community.status.rejected"), count: counts.rejected ?? 0 },
        { value: "log", label: t("community.mod.log") },
        { value: "members", label: t("community.mod.members") },
      ],
      section,
    );
    sections.querySelectorAll<HTMLButtonElement>("[data-section]").forEach(
      (button) =>
        (button.onclick = () => {
          section = button.dataset.section as Section;
          void load();
        }),
    );
  };

  /** Sends one decision, then loads the section again. */
  const decide = async (photo: ReviewPhoto, action: string, reason?: string) => {
    try {
      await api.request(`/api/community/photos/${photo.id}/review`, "POST", { action, reason: reason ?? "" });
      context.message(t("community.mod.done"));
      await context.changed();
      await load(true);
    } catch (error) {
      context.message(errorText(error));
    }
  };

  const facts = (photo: ReviewPhoto) =>
    (
      [
        [t("community.col.object"), photo.object_name ?? photo.declared_key],
        [t("community.viewer.captured"), dateText(photo.captured_at)],
        [t("community.mod.submitted"), dateTimeText(photo.submitted_at)],
        [t("community.field.licence"), licenceText(photo.licence)],
        [t("community.mod.size"), photo.width && photo.height ? `${formatCount(photo.width)} × ${formatCount(photo.height)} px` : ""],
        [t("community.field.equipment"), photo.equipment ?? ""],
        [t("community.field.processing"), photo.processing ?? ""],
        [t("community.field.caption"), photo.caption ?? ""],
      ] as [string, string][]
    )
      .filter(([, value]) => value)
      .map(([label, value]) => `<dt>${h(label)}</dt><dd>${h(value)}</dd>`)
      .join("");

  /** The buttons of a card. A decision that needs a reason opens a form in the card. */
  const actions = (photo: ReviewPhoto) => {
    const button = (action: string, label: string, primary = false) =>
      `<button type="button" class="${primary ? "primary-action" : "secondary-action"}" data-action="${action}">${h(label)}</button>`;
    if (photo.status === "review") return button("approve", t("community.mod.approve"), true) + button("reject", t("community.mod.reject"));
    if (photo.status === "published") return (photo.reports?.length ? button("approve", t("community.mod.keep"), true) : "") + button("hide", t("community.mod.hide"));
    return button("restore", t("community.mod.restore"));
  };

  const card = (photo: ReviewPhoto) => {
    const author = photo.author;
    const stats = t("community.mod.authorStats", {
      published: formatCount(author.published ?? 0),
      rejected: formatCount(author.rejected ?? 0),
      date: dateText(author.joined_at),
    });
    const duplicates = photo.duplicates?.length
      ? `<p class="community-note community-note--warning">${h(t("community.mod.sameFile", { list: photo.duplicates.map((item) => `${item.title} (@${item.handle})`).join(", ") }))}</p>`
      : "";
    const reports = photo.reports?.length
      ? `<div class="community-note community-note--warning"><strong>${h(t("community.mod.reports"))}</strong><ul>${photo.reports.map((report) => `<li>${h(report.reason)}</li>`).join("")}</ul></div>`
      : "";
    const last =
      photo.last_action && photo.status !== "review"
        ? `<p class="community-muted">${h(t("community.mod.lastDecision"))}: ${h([photo.last_action.moderator, dateText(photo.last_action.at)].filter(Boolean).join(" · "))} — ${h(photo.last_action.reason)}</p>`
        : "";
    return `<article class="community-review-card" data-id="${h(photo.id)}"><a class="community-review-card__image" href="${h(photo.image_url)}" ${NEW_TAB_LINK_ATTRIBUTES} title="${h(t("community.mod.openFull"))}"><img loading="lazy" decoding="async" src="${h(photo.image_url)}" alt="${h(photo.title)}"></a><div class="community-review-card__text"><header><h3>${h(photo.title)}</h3>${statusBadge(photo.status ?? "review")}${photo.composite ? `<span class="community-status">${h(t("community.field.composite"))}</span>` : ""}</header><p class="community-review-card__author"><strong>${h(author.name)}</strong> <span class="community-muted">@${h(author.handle)} · ${h(stats)}</span>${author.suspended ? ` <span class="community-status" data-status="rejected">${h(t("community.mod.suspended"))}</span>` : ""}</p>${reports}${duplicates}<dl class="community-facts">${facts(photo)}</dl>${last}<div class="community-actions" data-actions>${actions(photo)}</div></div></article>`;
  };

  const bindCards = (photos: ReviewPhoto[]) => {
    list.querySelectorAll<HTMLElement>(".community-review-card").forEach((node) => {
      const photo = photos.find((item) => item.id === node.dataset.id)!;
      const row = node.querySelector<HTMLElement>("[data-actions]")!;
      const bind = () =>
        row.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
          button.onclick = () => {
            const action = button.dataset.action!;
            if (action === "approve" || action === "restore") {
              button.disabled = true;
              void decide(photo, action);
              return;
            }
            // Rejection and hiding need a reason, because the photographer reads it.
            const confirm = t(action === "reject" ? "community.mod.confirmReject" : "community.mod.confirmHide");
            const original = row.innerHTML;
            row.innerHTML = `<form class="community-form community-reason"><div class="community-presets">${PRESETS.map((key) => `<button type="button" class="text-action" data-preset>${h(t(`community.mod.preset.${key}`))}</button>`).join("")}</div><label class="community-field"><span>${h(t("community.mod.reasonFor"))}</span><textarea name="reason" minlength="3" maxlength="2000" required></textarea></label><div class="community-actions"><button class="primary-action">${h(confirm)}</button><button type="button" class="secondary-action" data-cancel>${h(t("community.cancel"))}</button></div></form>`;
            const form = row.querySelector("form")!;
            const reason = form.querySelector("textarea")!;
            reason.focus();
            form.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((preset) => (preset.onclick = () => ((reason.value = preset.textContent ?? ""), reason.focus())));
            form.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => {
              row.innerHTML = original;
              bind();
            };
            form.onsubmit = (event) => {
              event.preventDefault();
              form.querySelector<HTMLButtonElement>(".primary-action")!.disabled = true;
              void decide(photo, action, reason.value);
            };
          };
        });
      bind();
    });
  };

  const paintPhotos = (photos: ReviewPhoto[], empty: string) => {
    list.innerHTML = photos.length ? photos.map(card).join("") : emptyState(empty);
    bindCards(photos);
  };

  const paintTours = (tours: ReviewTour[]) => {
    if (!tours.length) {
      list.innerHTML = emptyState(t("community.tours.emptyReview"));
      return;
    }
    list.innerHTML = tours
      .map((tour) => {
        const reports = tour.reports.length
          ? `<div class="community-note community-note--warning"><strong>${h(t("community.mod.reports"))}</strong><ul>${tour.reports.map((report) => `<li>${h(report.reason)}</li>`).join("")}</ul></div>`
          : "";
        const steps = tour.steps.map((step) => `<li><strong>${h(step.title)}</strong> ${h(step.body)}</li>`).join("");
        const buttons = tour.status === "hidden"
          ? `<button type="button" class="primary-action" data-tour-action="restore">${h(t("community.mod.restore"))}</button>`
          : `<button type="button" class="primary-action" data-tour-action="keep">${h(t("community.tours.keep"))}</button><button type="button" class="secondary-action" data-tour-action="hide">${h(t("community.mod.hide"))}</button>`;
        return `<article class="community-review-card community-review-card--tour" data-tour-id="${h(tour.id)}"><div><h3>${h(tour.title)}</h3><p class="community-muted">${h(tour.author.name)} · @${h(tour.author.handle)} · ${h(dateTimeText(tour.updated_at))}</p>${tour.moderation_reason ? `<p class="community-muted">${h(tour.moderation_reason)}</p>` : ""}${reports}<ol class="tour-builder__review-steps">${steps}</ol><div class="community-actions community-actions--wrap">${buttons}</div></div></article>`;
      })
      .join("");
    list.querySelectorAll<HTMLButtonElement>("[data-tour-action]").forEach((button) => {
      const id = button.closest<HTMLElement>("[data-tour-id]")!.dataset.tourId!;
      const action = button.dataset.tourAction!;
      const send = async (reason: string) => {
        await api.request(`/api/community/tours/${id}/review`, "POST", { action, reason });
        context.message(t("community.mod.done"));
        await context.changed();
        await load(true);
      };
      button.onclick = () => {
        if (action === "hide") context.dialogs.reasonForm(t("community.mod.hide"), t("community.mod.hide"), t("community.mod.reasonFor"), send);
        else send("").catch((error) => context.message(errorText(error)));
      };
    });
  };

  const paintTransits = (transits: ReviewTransit[]) => {
    if (!transits.length) {
      list.innerHTML = emptyState(t("transit.mod.empty"));
      return;
    }
    const minutes = (value: number) => t("transit.minutes", { value: formatFixed(value, 2) });
    const ppt = (value: unknown) => (typeof value === "number" ? t("transit.ppt", { value: formatFixed(value, 1) }) : "");
    list.innerHTML = transits
      .map((transit) => {
        const facts: [string, string][] = [
          [t("transit.result.mid"), dateTimeText(transit.mid_time_utc)],
          [t("transit.result.uncertainty"), `± ${minutes(transit.uncertainty_minutes)}`],
          [t("transit.result.oc"), `${minutes(transit.o_minus_c_minutes)} (± ${minutes(transit.predicted_uncertainty_minutes)})`],
          [t("transit.result.depth"), ppt(transit.depth_ppt)],
          [t("transit.result.duration"), minutes(transit.duration_minutes)],
          [t("transit.result.frames"), formatCount(transit.frame_count)],
          [t("transit.result.dropped"), formatCount(Number(transit.checks.frames_dropped ?? 0))],
          [t("transit.result.baseline"), ppt(transit.checks.baseline_rms_ppt)],
          [t("transit.result.comparison"), ppt(transit.checks.comparison_rms_ppt)],
          [t("transit.mod.chi"), typeof transit.checks.reduced_chi_square === "number" ? formatFixed(transit.checks.reduced_chi_square, 2) : ""],
          [t("transit.mod.redNoise"), typeof transit.checks.red_noise_factor === "number" ? formatFixed(transit.checks.red_noise_factor, 2) : ""],
          [t("transit.instrument"), transit.instrument],
        ];
        return `<article class="community-review-card community-review-card--tour" data-transit-id="${h(transit.id)}"><div><header><h3>${h(transit.object_name)}</h3><span class="community-status">${h(t(`transit.status.${transit.target_status}`))}</span></header><p class="community-muted">${h(transit.observer.name)} · @${h(transit.observer.handle)} · ${h(dateTimeText(transit.submitted_at))}</p>${lightCurveSvg(transit.measurements?.points ?? [], transit.measurements?.model, t("transit.curve.caption", { name: transit.object_name }))}<dl class="community-facts">${facts.filter(([, value]) => value).map(([label, value]) => `<dt>${h(label)}</dt><dd>${h(value)}</dd>`).join("")}</dl><div class="community-actions community-actions--wrap">${transit.review_state === "approved" ? `<button type="button" class="secondary-action" data-transit-action="hide">${h(t("community.mod.hide"))}</button>` : `<button type="button" class="primary-action" data-transit-action="approve">${h(t("community.mod.approve"))}</button><button type="button" class="secondary-action" data-transit-action="reject">${h(t("community.mod.reject"))}</button>`}</div></div></article>`;
      })
      .join("");
    list.querySelectorAll<HTMLButtonElement>("[data-transit-action]").forEach((button) => {
      const id = button.closest<HTMLElement>("[data-transit-id]")!.dataset.transitId!;
      const action = button.dataset.transitAction!;
      const send = async (reason: string) => {
        await api.request(`/api/community/transits/${id}/review`, "POST", { action, reason });
        context.message(t("community.mod.done"));
        await context.changed();
        await load(true);
      };
      button.onclick = () => {
        const label = t(action === "hide" ? "community.mod.hide" : "community.mod.reject");
        if (action === "approve") send("").catch((error) => context.message(errorText(error)));
        else context.dialogs.reasonForm(label, label, t("community.mod.reasonFor"), send);
      };
    });
  };

  const paintFindings = (findings: ReviewFinding[]) => {
    if (!findings.length) {
      list.innerHTML = emptyState(t("finding.mod.empty"));
      return;
    }
    list.innerHTML = findings
      .map((finding) => {
        const second = finding.second_frame;
        return `<article class="community-review-card community-review-card--tour" data-finding-id="${h(finding.id)}"><div><header><h3>${h(findingTitle(finding))}</h3></header><p class="community-muted">${h(findingFacts(finding))}</p><p class="community-muted">${h(finding.photo_title ?? "")} · ${h(finding.author?.name ?? "")} · ${h(dateTimeText(finding.captured_at))}</p>${blinkMarkup(finding.image_url, finding.wcs, finding)}${second ? `<p class="community-note">${h(t("finding.mod.second", { title: second.title, date: dateTimeText(second.captured_at) }))}</p>${blinkMarkup(second.image_url, second.wcs, { ...finding, x: second.x, y: second.y })}` : ""}<div class="community-actions community-actions--wrap"><button type="button" class="primary-action" data-finding-action="approve">${h(t("community.mod.approve"))}</button><button type="button" class="secondary-action" data-finding-action="reject">${h(t("community.mod.reject"))}</button></div></div></article>`;
      })
      .join("");
    bindBlink(list);
    list.querySelectorAll<HTMLButtonElement>("[data-finding-action]").forEach((button) => {
      const id = button.closest<HTMLElement>("[data-finding-id]")!.dataset.findingId!;
      const action = button.dataset.findingAction!;
      const send = async (reason: string) => {
        await api.request(`/api/community/findings/${id}/review`, "POST", { action, reason });
        context.message(t("community.mod.done"));
        await context.changed();
        await load(true);
      };
      button.onclick = () => {
        if (action === "reject") context.dialogs.reasonForm(t("community.mod.reject"), t("community.mod.reject"), t("community.mod.reasonFor"), send);
        else send("").catch((error) => context.message(errorText(error)));
      };
    });
  };

  const paintLog = (entries: ReviewAction[]) => {
    if (!entries.length) {
      list.innerHTML = emptyState(t("community.mod.emptyLog"));
      return;
    }
    const name = (action: string) =>
      ({ hide: t("community.status.hidden"), reject: t("community.status.rejected") })[action] ??
      (["approve", "restore", "author_remove", "account_delete", "cancel_votes", "suspend_account", "tour_keep", "tour_hide", "tour_restore", "transit_approve", "transit_reject", "transit_hide", "finding_approve", "finding_reject"].includes(action) ? t(`community.mod.action.${action}`) : action);
    list.innerHTML = `<div class="community-table-wrap"><table class="community-table"><thead><tr><th scope="col">${h(t("community.mod.col.date"))}</th><th scope="col">${h(t("community.mod.col.action"))}</th><th scope="col">${h(t("community.mod.col.moderator"))}</th><th scope="col">${h(t("community.mod.col.photo"))}</th><th scope="col">${h(t("community.field.reason"))}</th></tr></thead><tbody>${entries
      .map(
        (entry) =>
          `<tr><td>${h(dateTimeText(entry.at))}</td><td>${h(name(entry.action))}</td><td>${h(entry.moderator ?? "")}</td><td>${h(entry.photo_title ?? "")}</td><td>${h(entry.reason)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  };

  const paintMembers = () => {
    list.innerHTML = `<form class="community-form community-section"><p class="community-help">${h(t("community.mod.membersHelp"))}</p><div class="community-form__grid"><label class="community-field"><span>${h(t("community.field.handle"))}</span><input name="handle" required></label><label class="community-field"><span>${h(t("community.field.reason"))}</span><input name="reason" minlength="3" maxlength="2000" required></label></div><div class="community-actions community-actions--wrap"><button class="secondary-action" value="suspend">${h(t("community.mod.suspend"))}</button><button class="secondary-action" value="restore">${h(t("community.mod.restore"))}</button><button class="secondary-action" value="votes">${h(t("community.mod.cancelVotes"))}</button></div></form>`;
    const form = list.querySelector("form")!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      const action = (event.submitter as HTMLButtonElement | null)?.value ?? "suspend";
      try {
        await api.request(
          `/api/community/users/${encodeURIComponent(String(fields.get("handle")))}/${action === "votes" ? "cancel-votes" : "suspension"}`,
          "POST",
          { reason: fields.get("reason"), suspended: action === "suspend" },
        );
        context.message(t("community.mod.memberDone"));
        await context.changed();
      } catch (error) {
        context.message(errorText(error));
      }
    };
  };

  /** Loads the selected section. `quiet` keeps the status line, for a load that follows a decision. */
  async function load(quiet = false) {
    if (!quiet) context.message("");
    list.setAttribute("aria-busy", "true");
    try {
      // The queue request also gives the counts of all sections.
      const queue = await api.request<ReviewQueue>("/api/community/review");
      if (!context.current()) return;
      counts = queue.counts ?? { review: queue.photos.length, reports: queue.reports.length };
      paintSections();
      if (section === "review") paintPhotos(queue.photos, t("community.mod.emptyQueue"));
      else if (section === "reports") {
        // One card for each reported photo, with all its open reports.
        const photos = queue.reports
          .map((report) => ({ ...report.photo, reports: report.photo.reports?.length ? report.photo.reports : [{ reason: report.reason, at: report.at }] }))
          .filter((photo, index, all) => all.findIndex((other) => other.id === photo.id) === index);
        paintPhotos(photos, t("community.mod.emptyReports"));
      } else if (section === "tours") {
        const data = await api.request<{ tours: ReviewTour[] }>("/api/community/review/tours");
        if (context.current()) paintTours(data.tours);
      } else if (section === "transits") {
        // Timings that wait come first. An approved timing can still be hidden.
        const [waiting, approved] = await Promise.all(["review", "approved"].map((state) => api.request<{ transits: ReviewTransit[] }>(`/api/community/review/transits?state=${state}`)));
        if (context.current()) paintTransits([...waiting!.transits, ...approved!.transits]);
      } else if (section === "findings") {
        const data = await api.request<{ findings: ReviewFinding[] }>("/api/community/review/findings");
        if (context.current()) paintFindings(data.findings);
      } else if (section === "log") {
        const data = await api.request<{ actions: ReviewAction[] }>("/api/community/review/log");
        if (context.current()) paintLog(data.actions);
      } else if (section === "members") paintMembers();
      else {
        const data = await api.request<{ photos: ReviewPhoto[] }>(`/api/community/review/photos?status=${section}`);
        if (context.current()) paintPhotos(data.photos, t("community.mod.emptyList"));
      }
    } catch (error) {
      if (context.current()) context.message(errorText(error));
    } finally {
      list.removeAttribute("aria-busy");
    }
  }

  paintSections();
  await load();
}
