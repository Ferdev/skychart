import { formatCount, formatFixed } from "../format/quantity";
import { NEW_TAB_LINK_ATTRIBUTES } from "../format/links";
import { t } from "../i18n";
import { CommunityApi, errorText, type Coverage, type OwnPhoto, type Photo, type Photographer } from "./api";
import { dateText, emptyState, h, openDialog, photoCard, segmented, statusBadge, type DialogView } from "./communityUi";
import { renderReview } from "./communityReview";
import type { DialogHost, PhotoDialogs } from "./photoDialogs";

export type HubTab = "gallery" | "photographers" | "coverage" | "rules" | "account" | "review";

const CATALOGS = ["messier", "ngc", "ic"] as const;
const CATALOG_NAMES: Record<string, string> = { messier: "Messier", ngc: "NGC", ic: "IC" };

/**
 * The community window: one window with a tab for each part of the community area
 * (gallery, photographers, coverage, rules, the account, and the review tools of a moderator).
 */
export class CommunityHub {
  private view: DialogView | null = null;
  private panel: HTMLElement | null = null;
  private tab: HubTab = "gallery";
  /** A new render increases this number, so that a late response of an old tab is ignored. */
  private generation = 0;
  private sort = "all";
  private handle: string | null = null;
  private catalog = "";
  private query = "";

  constructor(
    readonly api: CommunityApi,
    readonly dialogs: PhotoDialogs,
    readonly changed: () => void,
    readonly host: DialogHost,
  ) {}

  get isOpen() {
    return Boolean(this.view?.dialog.isConnected);
  }

  open(tab: HubTab, options: { handle?: string } = {}) {
    if (tab === "review" && !this.api.moderator) tab = "gallery";
    this.tab = tab;
    this.handle = options.handle ?? null;
    if (!this.isOpen) {
      this.view = openDialog(t("community.title"), { variant: "hub", eyebrow: "Cosmic Atlas" });
      this.view.dialog.addEventListener("close", () => {
        this.view = null;
        this.panel = null;
      });
      this.view.body.innerHTML = `<div class="community-tabs" role="tablist"></div><div class="community-hub__panel" role="tabpanel" id="community-panel" tabindex="0"></div>`;
      this.panel = this.view.body.querySelector<HTMLElement>(".community-hub__panel");
    }
    this.paint();
  }

  close() {
    this.view?.dialog.close();
  }

  /** Paints the open tab again, for example after a sign-in or a change of language. */
  refresh() {
    if (this.isOpen) this.paint();
  }

  private tabs(): { id: HubTab; label: string; count?: number }[] {
    return [
      { id: "gallery", label: t("community.tab.gallery") },
      { id: "photographers", label: t("community.tab.photographers") },
      { id: "coverage", label: t("community.tab.coverage") },
      { id: "rules", label: t("community.tab.rules") },
      { id: "account", label: t("community.account.photos") },
      ...(this.api.moderator ? [{ id: "review" as const, label: t("community.review"), count: this.api.reviewCount }] : []),
    ];
  }

  private paint() {
    const view = this.view;
    const panel = this.panel;
    if (!view || !panel) return;
    if (this.tab === "review" && !this.api.moderator) this.tab = "gallery";
    view.dialog.setAttribute("aria-label", t("community.title"));
    view.header.querySelector("h2")!.textContent = t("community.title");
    view.header.querySelector("[data-close]")!.setAttribute("aria-label", t("community.close"));
    const list = view.body.querySelector<HTMLElement>(".community-tabs")!;
    list.setAttribute("aria-label", t("community.tabs"));
    list.innerHTML = this.tabs()
      .map(
        (tab) =>
          `<button type="button" role="tab" id="community-tab-${tab.id}" data-tab="${tab.id}" aria-controls="community-panel" aria-selected="${tab.id === this.tab}" tabindex="${tab.id === this.tab ? 0 : -1}">${h(tab.label)}${tab.count ? ` <span class="community-count">${h(formatCount(tab.count))}</span>` : ""}</button>`,
      )
      .join("");
    const buttons = [...list.querySelectorAll<HTMLButtonElement>("[data-tab]")];
    buttons.forEach((button, index) => {
      button.onclick = () => this.open(button.dataset.tab as HubTab);
      // The arrow keys move between the tabs, as in the object inspector.
      button.onkeydown = (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = buttons[(index + step + buttons.length) % buttons.length]!;
        this.open(next.dataset.tab as HubTab);
        this.view?.body.querySelector<HTMLButtonElement>(`#community-tab-${next.dataset.tab}`)?.focus();
      };
    });
    panel.setAttribute("aria-labelledby", `community-tab-${this.tab}`);
    view.message.textContent = "";
    panel.scrollTop = 0;
    const generation = ++this.generation;
    const current = () => generation === this.generation && panel.isConnected;
    const render = {
      gallery: () => this.gallery(panel, current),
      photographers: () => (this.handle ? this.profile(panel, this.handle, current) : this.photographers(panel, current)),
      coverage: () => this.coverage(panel, current),
      rules: () => this.rules(panel),
      account: () => this.account(panel, current),
      review: () =>
        renderReview(panel, {
          api: this.api,
          dialogs: this.dialogs,
          current,
          message: (text) => (view.message.textContent = text),
          // A decision changes the galleries, the map cards, and the count on the tab.
          changed: async () => {
            await this.api.session();
            this.changed();
            const badge = list.querySelector("[data-tab='review'] .community-count");
            if (badge) badge.textContent = this.api.reviewCount ? formatCount(this.api.reviewCount) : "";
          },
        }),
    }[this.tab];
    void Promise.resolve(render()).catch((error) => {
      if (current()) view.message.textContent = errorText(error);
    });
  }

  private bindPhotos(root: HTMLElement, photos: Photo[]) {
    root.querySelectorAll<HTMLButtonElement>("[data-photo]").forEach(
      (button) =>
        (button.onclick = () => {
          const photo = photos.find((item) => item.id === button.dataset.photo);
          if (photo) void this.dialogs.photo(photo, photos);
        }),
    );
  }

  private async gallery(panel: HTMLElement, current: () => boolean) {
    panel.innerHTML = `<div class="community-toolbar"><p class="community-help">${h(t("community.intro"))} ${h(t("community.gallery.howTo"))}</p>${segmented(
      t("community.sort.label"),
      "sort",
      [
        { value: "all", label: t("community.sort.top") },
        { value: "trend", label: t("community.sort.trending") },
        { value: "new", label: t("community.sort.newest") },
      ],
      this.sort,
    )}</div><div class="community-photo-grid" aria-busy="true"></div>`;
    panel.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach(
      (button) =>
        (button.onclick = () => {
          this.sort = button.dataset.sort!;
          this.paint();
        }),
    );
    const grid = panel.querySelector<HTMLElement>(".community-photo-grid")!;
    let photos: Photo[] = [];
    const load = async () => {
      const offset = this.sort === "new" && photos.length ? `&offset=${photos.length}` : "";
      const data = await this.api.request<{ photos: Photo[] }>(`/api/community/rankings?period=${this.sort}${offset}`);
      if (!current()) return;
      photos = [...photos, ...data.photos.filter((photo) => !photos.some((old) => old.id === photo.id))];
      grid.removeAttribute("aria-busy");
      panel.querySelector(".community-more")?.remove();
      if (!photos.length) {
        grid.outerHTML = emptyState(t("community.gallery.none"), t("community.gallery.howTo"));
        return;
      }
      // A position is shown only for the order by appreciations, and only for a photo that has one.
      grid.innerHTML = photos
        .map((photo, index) => photoCard(photo, { object: true, rank: this.sort === "all" && photo.votes > 0 ? index + 1 : undefined }))
        .join("");
      this.bindPhotos(grid, photos);
      if (this.sort === "new" && data.photos.length === 24) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "secondary-action community-more";
        more.textContent = t("community.loadMore");
        more.onclick = () => void load().catch((error) => (this.view!.message.textContent = errorText(error)));
        grid.after(more);
      }
    };
    await load();
  }

  private async photographers(panel: HTMLElement, current: () => boolean) {
    panel.innerHTML = `<p class="community-help">${h(t("community.photographers.help"))}</p><div class="community-table-wrap" aria-busy="true"></div>`;
    const data = await this.api.request<{ photographers: Photographer[] }>("/api/community/photographers");
    if (!current()) return;
    const wrap = panel.querySelector<HTMLElement>(".community-table-wrap")!;
    wrap.removeAttribute("aria-busy");
    if (!data.photographers.length) {
      wrap.outerHTML = emptyState(t("community.photographers.empty"), t("community.gallery.howTo"));
      return;
    }
    const number = (value: number | undefined) => `<td class="community-number">${h(formatCount(value ?? 0))}</td>`;
    wrap.innerHTML = `<table class="community-table"><thead><tr><th scope="col" class="community-number">#</th><th scope="col">${h(t("community.col.photographer"))}</th><th scope="col" class="community-number">${h(t("community.col.photos"))}</th><th scope="col" class="community-number">${h(t("community.col.objects"))}</th><th scope="col" class="community-number">${h(t("community.col.votes"))}</th><th scope="col" class="community-number">${h(t("community.col.covers"))}</th><th scope="col" class="community-number">${h(t("community.col.firsts"))}</th><th scope="col" class="community-number">${h(t("community.col.hindex"))}</th></tr></thead><tbody>${data.photographers
      .map(
        (person, index) =>
          `<tr><td class="community-number">${index + 1}</td><th scope="row"><button type="button" class="community-link" data-handle="${h(person.handle)}">${h(person.name)}</button> <span class="community-muted">@${h(person.handle)}</span></th>${number(person.photos)}${number(person.objects)}${number(person.votes)}${number(person.covers)}${number(person.first_photos)}${number(person.h_index)}</tr>`,
      )
      .join("")}</tbody></table>`;
    wrap.querySelectorAll<HTMLButtonElement>("[data-handle]").forEach(
      (button) => (button.onclick = () => this.open("photographers", { handle: button.dataset.handle })),
    );
  }

  private async profile(panel: HTMLElement, handle: string, current: () => boolean) {
    panel.innerHTML = `<button type="button" class="text-action community-back" data-back>‹ ${h(t("community.profile.back"))}</button><div class="community-profile" aria-busy="true"></div>`;
    panel.querySelector<HTMLButtonElement>("[data-back]")!.onclick = () => this.open("photographers");
    const root = panel.querySelector<HTMLElement>(".community-profile")!;
    let data: { photographer: Photographer; photos: Photo[] };
    try {
      data = await this.api.request(`/api/community/photographers/${encodeURIComponent(handle)}`);
    } catch {
      if (current()) root.outerHTML = emptyState(t("community.profile.missing"));
      return;
    }
    if (!current()) return;
    root.removeAttribute("aria-busy");
    const person = data.photographer;
    const tile = (label: string, value: number | undefined) =>
      `<div class="community-stat"><dt>${h(label)}</dt><dd>${h(formatCount(value ?? 0))}</dd></div>`;
    root.innerHTML = `<header class="community-profile__head"><h3>${h(person.name)}</h3><p class="community-muted">@${h(person.handle)}${person.joined_at ? ` · ${h(t("community.profile.joined", { date: dateText(person.joined_at) }))}` : ""}</p></header><dl class="community-stats">${tile(t("community.col.photos"), person.photos)}${tile(t("community.col.objects"), person.objects)}${tile(t("community.col.votes"), person.votes)}${tile(t("community.col.covers"), person.covers)}${tile(t("community.col.firsts"), person.first_photos)}${tile(t("community.col.hindex"), person.h_index)}</dl>${
      data.photos.length
        ? `<div class="community-photo-grid">${data.photos.map((photo) => photoCard(photo, { object: true })).join("")}</div>`
        : emptyState(t("community.profile.empty"))
    }`;
    this.bindPhotos(root, data.photos);
  }

  private async coverage(panel: HTMLElement, current: () => boolean) {
    panel.innerHTML = `<p class="community-help">${h(t("community.coverage.intro"))}</p><dl class="community-stats community-stats--progress" aria-busy="true"></dl><div class="community-toolbar"><label class="community-field community-field--inline"><span class="sr-only">${h(t("community.coverage.filter"))}</span><input type="search" data-query placeholder="${h(t("community.coverage.filter"))}" value="${h(this.query)}"></label>${segmented(
      t("community.coverage.catalog"),
      "catalog",
      [{ value: "", label: t("community.coverage.all") }, ...CATALOGS.map((name) => ({ value: name, label: CATALOG_NAMES[name]! }))],
      this.catalog,
    )}</div><div class="community-table-wrap" data-results></div><p class="community-muted" data-shown></p>`;
    const stats = panel.querySelector<HTMLElement>(".community-stats")!;
    const results = panel.querySelector<HTMLElement>("[data-results]")!;
    const shown = panel.querySelector<HTMLElement>("[data-shown]")!;
    let request = 0;
    const load = async () => {
      const mine = ++request;
      const params = new URLSearchParams();
      if (this.catalog) params.set("catalog", this.catalog);
      if (this.query) params.set("q", this.query);
      const search = params.toString();
      const data = await this.api.request<Coverage>(`/api/community/coverage${search ? `?${search}` : ""}`);
      if (!current() || mine !== request) return;
      stats.removeAttribute("aria-busy");
      stats.innerHTML = CATALOGS.map((name) => {
        const group = data.catalogs?.[name];
        if (!group) return "";
        return `<div class="community-stat"><dt>${h(CATALOG_NAMES[name]!)}</dt><dd>${h(t("community.coverage.progress", { covered: formatCount(group.covered), total: formatCount(group.total) }))}</dd><progress max="${group.total}" value="${group.covered}" aria-label="${h(CATALOG_NAMES[name]!)}"></progress></div>`;
      }).join("");
      if (!data.objects.length) {
        results.innerHTML = emptyState(t("community.coverage.empty"));
        shown.textContent = "";
        return;
      }
      results.innerHTML = `<table class="community-table"><thead><tr><th scope="col">${h(t("community.col.object"))}</th><th scope="col">${h(t("community.col.type"))}</th><th scope="col">${h(t("community.col.constellation"))}</th><th scope="col" class="community-number">${h(t("community.col.magnitude"))}</th><th scope="col"><span class="sr-only">${h(t("community.publish"))}</span></th></tr></thead><tbody>${data.objects
        .map(
          (object) =>
            `<tr><th scope="row"><button type="button" class="community-link" data-object="${h(object.key)}" title="${h(t("community.showOnMap"))}">${h(object.name)}</button></th><td>${h(object.type ?? "")}</td><td>${h(object.constellation ?? "")}</td><td class="community-number">${typeof object.magnitude === "number" ? h(formatFixed(object.magnitude, 1)) : ""}</td><td class="community-table__action"><button type="button" class="text-action" data-publish="${h(object.key)}" data-name="${h(object.name)}">${h(t("community.publish"))}</button></td></tr>`,
        )
        .join("")}</tbody></table>`;
      shown.textContent = t("community.coverage.shown", { shown: formatCount(data.objects.length), matched: formatCount(data.matched ?? data.objects.length) });
      results.querySelectorAll<HTMLButtonElement>("[data-object]").forEach((button) => (button.onclick = () => this.host.openObject(button.dataset.object!)));
      results.querySelectorAll<HTMLButtonElement>("[data-publish]").forEach(
        (button) => (button.onclick = () => this.dialogs.upload(button.dataset.publish!, button.dataset.name!)),
      );
    };
    const fail = (error: unknown) => {
      if (current()) this.view!.message.textContent = errorText(error);
    };
    panel.querySelectorAll<HTMLButtonElement>("[data-catalog]").forEach(
      (button) =>
        (button.onclick = () => {
          this.catalog = button.dataset.catalog!;
          panel.querySelectorAll<HTMLButtonElement>("[data-catalog]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
          void load().catch(fail);
        }),
    );
    let timer = 0;
    panel.querySelector<HTMLInputElement>("[data-query]")!.oninput = (event) => {
      this.query = (event.target as HTMLInputElement).value.trim();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load().catch(fail), 300);
    };
    await load();
  }

  private rules(panel: HTMLElement) {
    const list = (keys: string[]) => keys.map((key) => `<li>${h(t(key))}</li>`).join("");
    const link = (page: string, key: string) => `<a href="/community/${page}" ${NEW_TAB_LINK_ATTRIBUTES}>${h(t(key))}</a>`;
    panel.innerHTML = `<p class="community-lede">${h(t("community.rules.intro"))}</p><div class="community-rules"><section><h3>${h(t("community.rules.accepted"))}</h3><ul>${list(["community.rules.accepted1", "community.rules.accepted2", "community.rules.accepted3"])}</ul></section><section><h3>${h(t("community.rules.rejected"))}</h3><ul>${list(["community.rules.rejected1", "community.rules.rejected2", "community.rules.rejected3"])}</ul></section><section class="community-rules__wide"><h3>${h(t("community.rules.steps"))}</h3><ol>${list(["community.rules.step1", "community.rules.step2", "community.rules.step3"])}</ol></section></div><nav class="community-links" aria-label="${h(t("community.rules.full"))}"><span class="community-muted">${h(t("community.rules.full"))}</span>${link("rules", "community.rules.title")}${link("terms", "community.terms")}${link("privacy", "community.privacy")}${link("takedown", "community.takedown")}</nav>`;
  }

  private async account(panel: HTMLElement, current: () => boolean) {
    if (!this.api.user) {
      panel.innerHTML = `<div class="community-empty"><p>${h(t("community.account.signInPrompt"))}</p><p><button type="button" class="primary-action" data-sign-in>${h(t("community.signIn"))}</button></p></div>`;
      panel.querySelector<HTMLButtonElement>("[data-sign-in]")!.onclick = () => this.dialogs.login(() => this.open("account"));
      return;
    }
    const user = this.api.user;
    const message = (text: string) => {
      if (this.view) this.view.message.textContent = text;
    };
    panel.innerHTML = `<section class="community-section"><h3>${h(t("community.account.photos"))}</h3><div data-photos aria-busy="true"></div></section><section class="community-section"><h3>${h(t("community.account.profile"))}</h3><form class="community-form" data-profile><div class="community-form__grid"><label class="community-field"><span>${h(t("community.field.name"))}</span><input name="name" value="${h(user.name)}" maxlength="80" required></label><label class="community-field"><span>${h(t("community.field.handle"))}</span><input name="handle" value="${h(user.handle)}" pattern="[a-z][a-z0-9-]{2,39}" aria-describedby="community-handle-help" required></label><p class="community-field__help" id="community-handle-help">${h(t("community.account.handleHelp"))}</p></div><div class="community-actions"><button class="secondary-action">${h(t("community.account.save"))}</button></div></form></section><section class="community-section"><h3>${h(t("community.account.data"))}</h3><div class="community-actions community-actions--wrap"><button type="button" class="text-action" data-export>${h(t("community.account.export"))}</button><button type="button" class="text-action" data-logout>${h(t("community.signOut"))}</button><button type="button" class="text-action community-danger" data-delete>${h(t("community.account.remove"))}</button></div></section>`;
    const form = panel.querySelector<HTMLFormElement>("[data-profile]")!;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      try {
        await this.api.request("/api/community/profile", "PATCH", { name: fields.get("name"), handle: fields.get("handle") });
        await this.api.session();
        message(t("community.account.saved"));
        this.changed();
      } catch (error) {
        message(errorText(error));
      }
    };
    panel.querySelector<HTMLButtonElement>("[data-export]")!.onclick = async () => {
      try {
        const data = await this.api.request("/api/community/export");
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "cosmic-atlas-account.json";
        link.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        message(errorText(error));
      }
    };
    panel.querySelector<HTMLButtonElement>("[data-logout]")!.onclick = async () => {
      try {
        await this.api.request("/api/community/logout", "POST", {});
        this.api.signOutLocally();
        this.changed();
        this.open("gallery");
      } catch (error) {
        message(errorText(error));
      }
    };
    panel.querySelector<HTMLButtonElement>("[data-delete]")!.onclick = () => {
      const remove = openDialog(t("community.account.remove"), { variant: "narrow" });
      remove.body.innerHTML = `<p>${h(t("community.account.removeText"))}</p><div class="community-actions"><button type="button" class="primary-action community-danger" data-confirm>${h(t("community.account.removeConfirm"))}</button><button type="button" class="secondary-action" data-cancel>${h(t("community.cancel"))}</button></div>`;
      remove.body.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => remove.dialog.close();
      remove.body.querySelector<HTMLButtonElement>("[data-confirm]")!.onclick = async () => {
        try {
          await this.api.request("/api/community/account", "DELETE", {});
          this.api.signOutLocally();
          remove.dialog.close();
          this.changed();
          this.open("gallery");
        } catch (error) {
          remove.message.textContent = errorText(error);
        }
      };
    };

    const data = await this.api.request<{ photos: OwnPhoto[] }>("/api/community/me");
    if (!current()) return;
    const list = panel.querySelector<HTMLElement>("[data-photos]")!;
    list.removeAttribute("aria-busy");
    if (!data.photos.length) {
      list.innerHTML = emptyState(t("community.account.noPhotos"));
      return;
    }
    list.innerHTML = `<ul class="community-own-list">${data.photos
      .map((photo) => {
        const ready = !["uploading", "processing", "failed"].includes(photo.status);
        return `<li class="community-own" data-id="${h(photo.id)}">${photo.thumbnail_url ? `<img loading="lazy" decoding="async" src="${h(photo.thumbnail_url)}" alt="">` : `<span class="community-own__blank" aria-hidden="true"></span>`}<div class="community-own__text"><strong>${h(photo.title)}</strong><span class="community-muted">${h([photo.object_name, dateText(photo.inserted_at)].filter(Boolean).join(" · "))}</span>${statusBadge(photo.status)}${photo.moderation_reason && ["rejected", "hidden"].includes(photo.status) ? `<p class="community-note">${h(t("community.account.note", { reason: photo.moderation_reason }))}</p>` : ""}</div><div class="community-actions community-actions--wrap">${ready ? `<button type="button" class="text-action" data-wcs>${h(t("community.wcs.title"))}</button><button type="button" class="text-action" data-solve>${h(t("community.wcs.solve"))}</button>` : ""}<button type="button" class="text-action community-danger" data-remove>${h(t("community.remove"))}</button></div></li>`;
      })
      .join("")}</ul>`;
    list.querySelectorAll<HTMLElement>(".community-own").forEach((row) => {
      const id = row.dataset.id!;
      const solve = row.querySelector<HTMLButtonElement>("[data-solve]");
      if (solve)
        solve.onclick = async () => {
          try {
            await this.api.request(`/api/community/photos/${id}/solve`, "POST", {});
            message(t("community.wcs.queued"));
          } catch (error) {
            message(errorText(error));
          }
        };
      const wcs = row.querySelector<HTMLButtonElement>("[data-wcs]");
      if (wcs) wcs.onclick = () => this.dialogs.skyCoordinates(id, () => message(t("community.wcs.saved")));
      row.querySelector<HTMLButtonElement>("[data-remove]")!.onclick = async () => {
        try {
          await this.api.request(`/api/community/photos/${id}`, "DELETE", {});
          row.remove();
          this.changed();
        } catch (error) {
          message(errorText(error));
        }
      };
    });
  }
}
