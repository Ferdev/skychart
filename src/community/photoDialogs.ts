import { cx, communityHtml } from "./copy";
import { escapeHtml as h } from "../atlasFormatting";
import { CommunityApi, type Photo } from "./api";
import { ct } from "./translations";
export class PhotoDialogs {
  constructor(
    readonly api: CommunityApi,
    readonly changed: () => void,
  ) {}
  dialog(title: string) {
    const dialog = document.createElement("dialog");
    dialog.className = "community-dialog";
    dialog.setAttribute("aria-label", title);
    dialog.innerHTML = communityHtml`<header><h2>${h(title)}</h2><button type="button" aria-label="${h(ct(5))}">×</button></header><div class="community-dialog-body"></div><p role="status" class="community-message"></p>`;
    dialog
      .querySelector("header button")!
      .addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    return {
      dialog,
      body: dialog.querySelector<HTMLElement>(".community-dialog-body")!,
      message: dialog.querySelector<HTMLElement>(".community-message")!,
    };
  }
  async login(after?: () => void) {
    const view = this.dialog(ct(3));
    view.body.innerHTML = communityHtml`<form><label>${h(ct(12))}<input name="email" type="email" autocomplete="email" required></label><button>${h(ct(10))}</button></form>`;
    const emailForm = view.body.querySelector("form")!;
    emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = String(new FormData(emailForm).get("email"));
      try {
        await this.api.request("/api/community/code", "POST", { email });
        view.body.innerHTML = communityHtml`<form><label>${h(ct(13))}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><button>${h(ct(11))}</button></form>`;
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
            view.dialog.close();
            this.changed();
            after?.();
          } catch (error) {
            view.message.textContent = String(error);
          }
        });
      } catch (error) {
        view.message.textContent = String(error);
      }
    });
  }
  async photo(photo: Photo) {
    const view = this.dialog(photo.title);
    try {
      photo = await this.api.request<Photo>(`/api/photos/${photo.id}`);
    } catch (error) {
      view.message.textContent = String(error);
      return;
    }
    if (!view.dialog.isConnected) return;
    const canHide = ["admin", "moderator"].includes(this.api.user?.role ?? "");
    view.body.innerHTML = communityHtml`<img class="community-full-photo" src="${h(photo.image_url)}" alt="${h(photo.title)}"><p>${h(photo.caption)}</p><p class="community-credit">${h(photo.author.name)} · ${h(photo.licence)} · ${h(photo.captured_at.slice(0, 10))}</p><p>${h(photo.equipment)} ${h(photo.processing)}</p><div class="community-actions"><button data-vote>${h(ct(4))} · ${photo.votes}</button><button data-report>${h(ct(8))}</button>${canHide ? `<button data-hide>${h(cx("Hide"))}</button>` : ""}<a href="/o/${encodeURIComponent(photo.declared_key)}">Open object</a></div>`;
    let voted = false;
    const image = view.body.querySelector<HTMLImageElement>(
      ".community-full-photo",
    )!;
    const stage = document.createElement("div");
    stage.className = "community-photo-stage";
    image.before(stage);
    stage.append(image);
    const resize = new ResizeObserver(() => {
      stage.style.width = `${image.getBoundingClientRect().width}px`;
    });
    resize.observe(image);
    view.dialog.addEventListener("close", () => resize.disconnect());
    for (const tag of photo.in_frame ?? []) {
      const label = document.createElement("a");
      label.href = `/o/${encodeURIComponent(tag.key)}`;
      label.textContent = tag.name;
      label.className = "community-in-frame";
      label.style.left = `${tag.x * 100}%`;
      label.style.top = `${tag.y * 100}%`;
      stage.append(label);
    }
    if (photo.wcs) {
      const provenance = document.createElement("p");
      provenance.className = "community-credit";
      provenance.textContent =
        photo.wcs.status === "solved"
          ? "Plate solution: Astrometry.net · ICRS, J2000"
          : "Sky coordinates supplied by the author · ICRS, J2000";
      view.body.append(provenance);
      const comparison = document.createElement("button");
      comparison.textContent = cx("Compare survey");
      comparison.onclick = () => {
        const w = photo.wcs!;
        const url = new URLSearchParams({
          provider: "dss2",
          ra: String(w.ra_deg),
          dec: String(w.dec_deg),
          fov: String(
            Math.max(
              0.01,
              Math.min(
                5,
                (Math.max(w.width, w.height) * w.pixel_scale_arcsec) / 3600,
              ),
            ),
          ),
        });
        const survey = this.dialog(cx("Compare survey"));
        survey.body.innerHTML = `<img class="community-full-photo" src="/api/survey-image?${h(url.toString())}" alt="DSS2"><p>DSS2 · CDS / STScI</p><p>${h(cx("Archival field. Orientation can differ."))}</p><a href="https://aladin.cds.unistra.fr/AladinLite/" target="_blank" rel="noopener noreferrer">CDS Aladin</a>`;
      };
      view.body.append(comparison);
    }
    if (this.api.user) {
      try {
        voted = (
          await this.api.request<{ present: boolean }>(
            `/api/community/photos/${photo.id}/vote`,
          )
        ).present;
      } catch {}
    }
    const voteButton =
      view.body.querySelector<HTMLButtonElement>("[data-vote]")!;
    voteButton.setAttribute("aria-pressed", String(voted));
    voteButton.disabled = this.api.user?.handle === photo.author.handle;
    view.body.querySelector<HTMLButtonElement>("[data-vote]")!.onclick =
      async () => {
        if (!this.api.user) {
          view.dialog.close();
          void this.login(() => void this.photo(photo));
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
          voteButton.setAttribute("aria-pressed", String(voted));
          voteButton.textContent = `${ct(4)} · ${result.votes}`;
          this.changed();
        } catch (error) {
          view.message.textContent = String(error);
        }
      };
    view.body.querySelector<HTMLButtonElement>("[data-report]")!.onclick =
      () =>
        this.reasonForm(ct(8), cx("Send report"), async (reason) => {
          await this.api.request(`/api/photos/${photo.id}/report`, "POST", {
            reason,
          });
        });
    const hide = view.body.querySelector<HTMLButtonElement>("[data-hide]");
    if (hide)
      hide.onclick = () =>
        this.reasonForm(cx("Hide"), cx("Hide"), async (reason) => {
          await this.api.request(
            `/api/community/photos/${photo.id}/review`,
            "POST",
            { action: "hide", reason },
          );
          view.dialog.close();
          this.changed();
        });
  }
  /** Small dialog asking for a reason; closes itself once `send` succeeds. */
  private reasonForm(
    title: string,
    submit: string,
    send: (reason: string) => Promise<void>,
  ) {
    const view = this.dialog(title);
    view.body.innerHTML = communityHtml`<form><label>Reason<textarea name="reason" minlength="3" maxlength="2000" required></textarea></label><button>${h(submit)}</button></form>`;
    const form = view.body.querySelector("form")!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await send(String(new FormData(form).get("reason")));
        view.dialog.close();
      } catch (error) {
        view.message.textContent = String(error);
      }
    };
  }
  upload(key: string, name: string) {
    if (!this.api.user) {
      void this.login(() => this.upload(key, name));
      return;
    }
    const view = this.dialog(`${ct(1)} · ${name}`);
    view.body.innerHTML = communityHtml`<form><label>Image<input name="file" type="file" accept="image/jpeg,image/png,image/tiff" required></label><p>JPEG, PNG or TIFF · 60 MB · 120 megapixels</p><label>Title<input name="title" maxlength="160" required></label><label>Capture time (UTC)<input name="captured_at" type="datetime-local" required></label><label>Caption<textarea name="caption" maxlength="4000"></textarea></label><label>Equipment<input name="equipment" maxlength="500"></label><label>Processing<input name="processing" maxlength="1000"></label><label>Licence<select name="licence"><option>All rights reserved</option><option>CC BY 4.0</option><option>CC BY-SA 4.0</option><option>CC0</option></select></label><label><input type="checkbox" name="composite">Composite or heavily processed photo</label><label><input type="checkbox" name="rights" required>I own this photo or have permission to publish it. This is not a synthetic AI image.</label><p>The first three photos need moderator review. Your copyright stays with you.</p><p><a href="/community/terms" target="_blank" rel="noopener">Terms</a> · <a href="/community/privacy" target="_blank" rel="noopener">Privacy</a></p><button>${h(ct(1))}</button></form>`;
    const form = view.body.querySelector("form")!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const file = data.get("file") as File;
      if (file.size > 60_000_000) {
        view.message.textContent = cx("Use a file smaller than 60 MB.");
        return;
      }
      const button = form.querySelector("button")!;
      button.disabled = true;
      try {
        view.message.textContent = cx("Preparing upload…");
        const intent = await this.api.request<{
          photo_id: string;
          upload: { url: string; method: string; headers?: Record<string,string> };
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
        view.message.textContent = cx("Uploading…");
        const response = await fetch(intent.upload.url, {
          method: "PUT",
          body: file,
          headers: { "content-type": file.type || "application/octet-stream", ...intent.upload.headers },
          credentials: "omit",
        });
        if (!response.ok)
          throw new Error(cx("Upload failed. Please try again."));
        await this.api.request(
          `/api/community/photos/${intent.photo_id}/complete`,
          "POST",
          {},
        );
        view.body.textContent = cx(
          "Your photo is processing. Check its status in your account.",
        );
        view.message.textContent = cx("Upload received.");
        this.changed();
      } catch (error) {
        view.message.textContent = String(error);
        button.disabled = false;
      }
    };
  }
  async account() {
    if (!this.api.user) {
      await this.login();
      return;
    }
    const view = this.dialog(this.api.user.name);
    try {
      const data = await this.api.request<{
        photos: { id: string; title: string; status: string; moderation_reason?: string }[];
      }>("/api/community/me");
      view.body.innerHTML = communityHtml`<form><label>Display name<input name="name" value="${h(this.api.user.name)}" maxlength="80" required></label><label>Public handle<input name="handle" value="${h(this.api.user.handle)}" pattern="[a-z][a-z0-9-]{2,39}" required></label><button>Save profile</button></form><h3>My photos</h3><ul>${data.photos.map((p) => communityHtml`<li>${h(p.title)} · ${h(p.status)}${p.moderation_reason ? `<p>${h(p.moderation_reason)}</p>` : ""} <button data-remove="${h(p.id)}">Remove</button><button data-wcs="${h(p.id)}">Sky coordinates</button><button data-solve="${h(p.id)}">Solve field</button></li>`).join("")}</ul><div class="community-actions"><button data-export>Export account data</button><button data-delete>Remove account</button><button data-logout>Sign out</button></div>`;
      const form = view.body.querySelector("form")!;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        try {
          await this.api.request("/api/community/profile", "PATCH", {
            name: f.get("name"),
            handle: f.get("handle"),
          });
          await this.api.session();
          view.message.textContent = cx("Profile saved.");
          this.changed();
        } catch (e) {
          view.message.textContent = String(e);
        }
      };
      view.body.querySelector<HTMLButtonElement>("[data-export]")!.onclick =
        async () => {
          try {
            const data = await this.api.request("/api/community/export");
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "cosmic-atlas-account.json";
            a.click();
            URL.revokeObjectURL(url);
          } catch (error) {
            view.message.textContent = String(error);
          }
        };
      view.body.querySelector<HTMLButtonElement>("[data-delete]")!.onclick =
        () => {
          const remove = this.dialog(cx("Remove account"));
          remove.body.innerHTML =
            "<p>This removes your account and hides all your photos. This action cannot be undone.</p><button>Remove my account</button>";
          remove.body.querySelector("button")!.onclick = async () => {
            try {
              await this.api.request("/api/community/account", "DELETE", {});
              this.api.user = null;
              this.api.csrf = "";
              remove.dialog.close();
              view.dialog.close();
              this.changed();
            } catch (e) {
              remove.message.textContent = String(e);
            }
          };
        };
      view.body.querySelector<HTMLButtonElement>("[data-logout]")!.onclick =
        async () => {
          await this.api.request("/api/community/logout", "POST", {});
          this.api.user = null;
          this.api.csrf = "";
          view.dialog.close();
          this.changed();
        };
      view.body.querySelectorAll<HTMLButtonElement>("[data-solve]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await this.api.request(
                `/api/community/photos/${b.dataset.solve}/solve`,
                "POST",
                {},
              );
              view.message.textContent = cx("Plate solve queued.");
            } catch (e) {
              view.message.textContent = String(e);
            }
          }),
      );
      view.body.querySelectorAll<HTMLButtonElement>("[data-wcs]").forEach(
        (b) =>
          (b.onclick = () => {
            const w = this.dialog(`${cx("Sky coordinates")} (ICRS, J2000)`);
            w.body.innerHTML =
              "<form>" +
              [
                "ra_deg",
                "dec_deg",
                "pixel_scale_arcsec",
                "rotation_deg",
                "width",
                "height",
              ]
                .map(
                  (n) =>
                    communityHtml`<label>${n.replace(/_/g, " ")}<input type="number" step="any" name="${n}" required></label>`,
                )
                .join("") +
              "<p>Use a square-pixel TAN solution. These coordinates will be labelled as supplied by the author.</p><button>Save coordinates</button></form>";
            const f = w.body.querySelector("form")!;
            f.onsubmit = async (e) => {
              e.preventDefault();
              const attrs = Object.fromEntries(
                [...new FormData(f)].map(([k, v]) => [k, Number(v)]),
              );
              try {
                await this.api.request(
                  `/api/community/photos/${b.dataset.wcs}/wcs`,
                  "POST",
                  { wcs: attrs },
                );
                w.dialog.close();
                this.changed();
              } catch (e) {
                w.message.textContent = String(e);
              }
            };
          }),
      );
      view.body.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await this.api.request(
                `/api/community/photos/${b.dataset.remove}`,
                "DELETE",
                {},
              );
              b.parentElement!.remove();
              this.changed();
            } catch (e) {
              view.message.textContent = String(e);
            }
          }),
      );
    } catch (error) {
      view.message.textContent = String(error);
    }
  }
}
