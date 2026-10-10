import { formatCount } from "../format/quantity";
import { NEW_TAB_LINK_ATTRIBUTES } from "../format/links";
import { t } from "../i18n";
import { CommunityApi, errorText, type Photo } from "./api";
import { dateText, h, licenceText, openDialog, type DialogView } from "./communityUi";

/** Actions of the photo windows that other parts of the community area do. */
export type DialogHost = {
  /** Selects the object in the atlas and closes the community windows. */
  openObject: (key: string) => void;
  /** Opens the page of a photographer in the community window. */
  openPhotographer: (handle: string) => void;
};

const LICENCES = ["All rights reserved", "CC BY 4.0", "CC BY-SA 4.0", "CC0"];
const WCS_FIELDS = ["ra_deg", "dec_deg", "pixel_scale_arcsec", "rotation_deg", "width", "height"];

export class PhotoDialogs {
  host: DialogHost = { openObject: () => undefined, openPhotographer: () => undefined };
  constructor(
    readonly api: CommunityApi,
    readonly changed: () => void,
  ) {}

  /** Sign-in with a code that the server sends to the email address. */
  login(after?: () => void) {
    const view = openDialog(t("community.signIn"), { variant: "narrow" });
    view.body.innerHTML = `<form class="community-form"><p class="community-help">${h(t("community.login.help"))}</p><label class="community-field"><span>${h(t("community.email"))}</span><input name="email" type="email" autocomplete="email" required></label><div class="community-actions"><button class="primary-action">${h(t("community.sendCode"))}</button></div></form>`;
    const emailForm = view.body.querySelector("form")!;
    emailForm.querySelector("input")!.focus();
    emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = String(new FormData(emailForm).get("email"));
      try {
        await this.api.request("/api/community/code", "POST", { email });
        view.message.textContent = "";
        view.body.innerHTML = `<form class="community-form"><p class="community-help">${h(t("community.login.sent", { email }))}</p><label class="community-field"><span>${h(t("community.code"))}</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><div class="community-actions"><button class="primary-action">${h(t("community.verifyCode"))}</button></div></form>`;
        const codeForm = view.body.querySelector("form")!;
        codeForm.querySelector("input")!.focus();
        codeForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            const data = await this.api.request<{
              user: CommunityApi["user"];
              csrf: string;
            }>("/api/community/verify", "POST", {
              email,
              code: new FormData(codeForm).get("code"),
            });
            this.api.user = data.user;
            this.api.csrf = data.csrf;
            // The session gives the count of photos that wait for a moderator.
            if (this.api.moderator) await this.api.session();
            view.dialog.close();
            this.changed();
            after?.();
          } catch (error) {
            view.message.textContent = errorText(error);
          }
        });
      } catch (error) {
        view.message.textContent = errorText(error);
      }
    });
  }

  /**
   * The photo viewer. With a list, the viewer has buttons (and the arrow keys) for the previous and the next photo.
   */
  async photo(photo: Photo, list: Photo[] = []) {
    const view = openDialog(photo.title, { variant: "viewer", eyebrow: photo.object_name ?? t("community.title") });
    view.dialog.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") view.dialog.querySelector<HTMLButtonElement>("[data-step='-1']:not(:disabled)")?.click();
      if (event.key === "ArrowRight") view.dialog.querySelector<HTMLButtonElement>("[data-step='1']:not(:disabled)")?.click();
    });
    await this.showPhoto(view, photo, list);
  }

  private async showPhoto(view: DialogView, summary: Photo, list: Photo[]) {
    let photo = summary;
    view.message.textContent = "";
    try {
      photo = await this.api.request<Photo>(`/api/photos/${summary.id}`);
    } catch (error) {
      view.message.textContent = errorText(error);
      return;
    }
    if (!view.dialog.isConnected) return;
    view.dialog.setAttribute("aria-label", photo.title);
    view.header.querySelector("h2")!.textContent = photo.title;
    view.header.querySelector(".eyebrow")!.textContent = photo.object_name ?? t("community.title");
    const index = list.findIndex((item) => item.id === photo.id);
    view.header.querySelector(".community-viewer__steps")?.remove();
    if (list.length > 1 && index >= 0) {
      const steps = document.createElement("div");
      steps.className = "community-viewer__steps";
      steps.innerHTML = `<button type="button" class="icon-button" data-step="-1" aria-label="${h(t("community.previous"))}" ${index === 0 ? "disabled" : ""}>‹</button><span>${index + 1} / ${list.length}</span><button type="button" class="icon-button" data-step="1" aria-label="${h(t("community.next"))}" ${index === list.length - 1 ? "disabled" : ""}>›</button>`;
      view.header.querySelector("[data-close]")!.before(steps);
      steps.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(
        (button) => (button.onclick = () => void this.showPhoto(view, list[index + Number(button.dataset.step)]!, list)),
      );
    }
    const facts: [string, string][] = [
      [t("community.col.object"), photo.object_name ?? ""],
      [t("community.viewer.captured"), dateText(photo.captured_at)],
      [t("community.field.licence"), licenceText(photo.licence)],
      [t("community.field.equipment"), photo.equipment ?? ""],
      [t("community.field.processing"), photo.processing ?? ""],
    ];
    const coordinates = photo.wcs ? t(photo.wcs.status === "solved" ? "community.wcs.solved" : "community.wcs.author") : "";
    view.body.innerHTML = `<div class="community-viewer__layout"><figure class="community-viewer__stage"><div class="community-photo-stage"><img class="community-full-photo" src="${h(photo.image_url)}" alt="${h(photo.title)}"></div></figure><aside class="community-viewer__side" aria-label="${h(t("community.viewer.details"))}"><p class="community-viewer__author"><button type="button" class="community-link" data-author>${h(photo.author.name)}</button> <span>@${h(photo.author.handle)}</span></p><div class="community-actions"><button type="button" class="secondary-action" data-vote></button></div>${photo.caption ? `<p class="community-viewer__caption">${h(photo.caption)}</p>` : ""}<dl class="community-facts">${facts
      .filter(([, value]) => value)
      .map(([label, value]) => `<dt>${h(label)}</dt><dd>${h(value)}</dd>`)
      .join("")}</dl>${photo.composite ? `<p class="community-note">${h(t("community.field.composite"))}</p>` : ""}${coordinates ? `<p class="community-credit">${h(coordinates)}</p>` : ""}<div class="community-actions community-actions--wrap"><button type="button" class="text-action" data-open-object>${h(t("community.openObject"))}</button><button type="button" class="text-action" data-copy>${h(t("community.copyLink"))}</button>${photo.wcs ? `<button type="button" class="text-action" data-compare>${h(t("community.compare"))}</button>` : ""}<button type="button" class="text-action" data-report>${h(t("community.report"))}</button>${this.api.moderator ? `<button type="button" class="text-action" data-hide>${h(t("community.mod.hide"))}</button>` : ""}</div></aside></div>`;
    const stage = view.body.querySelector<HTMLElement>(".community-photo-stage")!;
    // The labels of the objects in the photo use fractions of the image, so the stage gets the width of the image.
    if (photo.in_frame?.length) {
      const image = stage.querySelector<HTMLImageElement>("img")!;
      const resize = new ResizeObserver(() => {
        if (!image.isConnected) return resize.disconnect();
        stage.style.width = `${image.getBoundingClientRect().width}px`;
      });
      resize.observe(image);
      view.dialog.addEventListener("close", () => resize.disconnect(), { once: true });
    }
    for (const tag of photo.in_frame ?? []) {
      const label = document.createElement("button");
      label.type = "button";
      label.textContent = tag.name;
      label.className = "community-in-frame";
      label.style.left = `${tag.x * 100}%`;
      label.style.top = `${tag.y * 100}%`;
      label.onclick = () => this.host.openObject(tag.key);
      stage.append(label);
    }
    view.body.querySelector<HTMLButtonElement>("[data-author]")!.onclick = () => {
      view.dialog.close();
      this.host.openPhotographer(photo.author.handle);
    };
    view.body.querySelector<HTMLButtonElement>("[data-open-object]")!.onclick = () => this.host.openObject(photo.declared_key);
    view.body.querySelector<HTMLButtonElement>("[data-copy]")!.onclick = async () => {
      try {
        await navigator.clipboard.writeText(new URL(`/photos/${photo.id}`, window.location.origin).toString());
        view.message.textContent = t("community.linkCopied");
      } catch (error) {
        view.message.textContent = errorText(error);
      }
    };
    const compare = view.body.querySelector<HTMLButtonElement>("[data-compare]");
    if (compare) compare.onclick = () => this.compareSurvey(photo);

    let voted = false;
    const voteButton = view.body.querySelector<HTMLButtonElement>("[data-vote]")!;
    const paintVote = () => {
      voteButton.setAttribute("aria-pressed", String(voted));
      voteButton.textContent = `${t("community.appreciate")} · ${formatCount(photo.votes)}`;
    };
    paintVote();
    voteButton.disabled = this.api.user?.handle === photo.author.handle;
    voteButton.onclick = async () => {
      if (!this.api.user) {
        view.dialog.close();
        this.login(() => void this.photo(photo, list));
        return;
      }
      try {
        const result = await this.api.request<{ votes: number }>(
          `/api/community/photos/${photo.id}/vote`,
          voted ? "DELETE" : "POST",
          {},
        );
        voted = !voted;
        photo.votes = result.votes;
        paintVote();
        this.changed();
      } catch (error) {
        view.message.textContent = errorText(error);
      }
    };
    view.body.querySelector<HTMLButtonElement>("[data-report]")!.onclick = () =>
      this.reasonForm(t("community.report"), t("community.sendReport"), t("community.report.help"), async (reason) => {
        await this.api.request(`/api/photos/${photo.id}/report`, "POST", { reason });
        view.message.textContent = t("community.report.sent");
      });
    const hide = view.body.querySelector<HTMLButtonElement>("[data-hide]");
    if (hide)
      hide.onclick = () =>
        this.reasonForm(t("community.mod.hide"), t("community.mod.hide"), t("community.mod.reasonFor"), async (reason) => {
          await this.api.request(`/api/community/photos/${photo.id}/review`, "POST", { action: "hide", reason });
          view.dialog.close();
          this.changed();
        });
    if (this.api.user) {
      try {
        voted = (await this.api.request<{ present: boolean }>(`/api/community/photos/${photo.id}/vote`)).present;
        if (voteButton.isConnected) paintVote();
      } catch {
        /* The vote state is optional: the button stays usable. */
      }
    }
  }

  /** The archival survey image of the same field, for a photo that has sky coordinates. */
  private compareSurvey(photo: Photo) {
    const w = photo.wcs!;
    const url = new URLSearchParams({
      provider: "dss2",
      ra: String(w.ra_deg),
      dec: String(w.dec_deg),
      fov: String(Math.max(0.01, Math.min(5, (Math.max(w.width, w.height) * w.pixel_scale_arcsec) / 3600))),
    });
    const survey = openDialog(t("community.compare"), { eyebrow: photo.title });
    survey.body.innerHTML = `<figure class="community-viewer__stage"><img class="community-full-photo" src="/api/survey-image?${h(url.toString())}" alt="DSS2"></figure><p class="community-credit">DSS2 · CDS / STScI · ${h(t("community.compare.note"))}</p><p><a href="https://aladin.cds.unistra.fr/AladinLite/" ${NEW_TAB_LINK_ATTRIBUTES}>CDS Aladin</a></p>`;
  }

  /** Small window that asks for a reason. It closes after `send` is successful. */
  reasonForm(title: string, submit: string, help: string, send: (reason: string) => Promise<void>) {
    const view = openDialog(title, { variant: "narrow" });
    view.body.innerHTML = `<form class="community-form"><p class="community-help">${h(help)}</p><label class="community-field"><span>${h(t("community.field.reason"))}</span><textarea name="reason" minlength="3" maxlength="2000" required></textarea></label><div class="community-actions"><button class="primary-action">${h(submit)}</button></div></form>`;
    const form = view.body.querySelector("form")!;
    form.querySelector("textarea")!.focus();
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await send(String(new FormData(form).get("reason")));
        view.dialog.close();
      } catch (error) {
        view.message.textContent = errorText(error);
      }
    };
  }

  /** The form that publishes a photo of one object. */
  upload(key: string, name: string) {
    if (!this.api.user) {
      this.login(() => this.upload(key, name));
      return;
    }
    const view = openDialog(`${t("community.publish")} · ${name}`);
    const field = (label: string, control: string, wide = false) =>
      `<label class="community-field${wide ? " community-field--wide" : ""}"><span>${h(label)}</span>${control}</label>`;
    view.body.innerHTML = `<form class="community-form"><div class="community-form__grid">${field(t("community.field.image"), `<input name="file" type="file" accept="image/jpeg,image/png,image/tiff" aria-describedby="community-upload-formats" required>`, true)}<p class="community-field__help" id="community-upload-formats">${h(t("community.upload.formats"))}</p>${field(t("community.field.title"), `<input name="title" maxlength="160" required>`)}${field(t("community.field.capturedAt"), `<input name="captured_at" type="datetime-local" required>`)}${field(t("community.field.caption"), `<textarea name="caption" maxlength="4000"></textarea>`, true)}${field(t("community.field.equipment"), `<input name="equipment" maxlength="500">`)}${field(t("community.field.processing"), `<input name="processing" maxlength="1000">`)}</div><fieldset class="community-fieldset"><legend>${h(t("community.upload.rightsHeading"))}</legend>${field(t("community.field.licence"), `<select name="licence">${LICENCES.map((licence) => `<option value="${h(licence)}">${h(licenceText(licence))}</option>`).join("")}</select>`)}<label class="community-check"><input type="checkbox" name="composite"><span>${h(t("community.field.composite"))}</span></label><label class="community-check"><input type="checkbox" name="rights" required><span>${h(t("community.field.rights"))}</span></label></fieldset><p class="community-note">${h(t("community.upload.notice"))}</p><div class="community-actions"><button class="primary-action">${h(t("community.publish"))}</button><span class="community-form__links"><a href="/community/rules" ${NEW_TAB_LINK_ATTRIBUTES}>${h(t("community.rules.title"))}</a><a href="/community/terms" ${NEW_TAB_LINK_ATTRIBUTES}>${h(t("community.terms"))}</a><a href="/community/privacy" ${NEW_TAB_LINK_ATTRIBUTES}>${h(t("community.privacy"))}</a></span></div></form>`;
    const form = view.body.querySelector("form")!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const file = data.get("file") as File;
      if (file.size > 60_000_000) {
        view.message.textContent = t("community.upload.tooLarge");
        return;
      }
      const button = form.querySelector<HTMLButtonElement>(".primary-action")!;
      button.disabled = true;
      try {
        view.message.textContent = t("community.upload.preparing");
        const intent = await this.api.request<{
          photo_id: string;
          upload: { url: string; method: string; headers?: Record<string, string> };
        }>("/api/community/uploads", "POST", {
          key,
          size_bytes: file.size,
          title: data.get("title"),
          caption: data.get("caption"),
          captured_at: new Date(`${data.get("captured_at")}Z`).toISOString(),
          licence: data.get("licence"),
          equipment: data.get("equipment"),
          processing: data.get("processing"),
          composite: data.has("composite"),
          rights_confirmed: true,
          synthetic: false,
        });
        view.message.textContent = t("community.upload.sending");
        const response = await fetch(intent.upload.url, {
          method: "PUT",
          body: file,
          headers: { "content-type": file.type || "application/octet-stream", ...intent.upload.headers },
          credentials: "omit",
        });
        if (!response.ok) throw new Error(t("community.upload.failed"));
        await this.api.request(`/api/community/photos/${intent.photo_id}/complete`, "POST", {});
        view.body.innerHTML = `<div class="community-empty"><p>${h(t("community.upload.processing"))}</p><p>${h(t("community.upload.notice"))}</p></div>`;
        view.message.textContent = t("community.upload.received");
        this.changed();
      } catch (error) {
        view.message.textContent = errorText(error);
        button.disabled = false;
      }
    };
  }

  /** The form for the sky coordinates of a photo (a square-pixel TAN solution). */
  skyCoordinates(photoId: string, saved: () => void) {
    const view = openDialog(t("community.wcs.title"), { eyebrow: "ICRS · J2000" });
    view.body.innerHTML = `<form class="community-form"><p class="community-help">${h(t("community.wcs.help"))}</p><div class="community-form__grid">${WCS_FIELDS.map((name) => `<label class="community-field"><span>${h(t(`community.wcs.field.${name}`))}</span><input type="number" step="any" name="${name}" required></label>`).join("")}</div><div class="community-actions"><button class="primary-action">${h(t("community.wcs.save"))}</button></div></form>`;
    const form = view.body.querySelector("form")!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const wcs = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, Number(value)]));
      try {
        await this.api.request(`/api/community/photos/${photoId}/wcs`, "POST", { wcs });
        view.dialog.close();
        saved();
        this.changed();
      } catch (error) {
        view.message.textContent = errorText(error);
      }
    };
  }
}
