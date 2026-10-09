import { cx, communityHtml } from "./copy";
import { footprintDirections } from "./photoFootprint";
import { escapeHtml as h } from "../atlasFormatting";
import { CommunityApi, type Photo, type Cover } from "./api";
import { PhotoIndex } from "./photoIndex";
import { PhotoDialogs } from "./photoDialogs";
import { ct } from "./translations";
import { planeCorners, planeTransform } from "./photoPlane";
type Marker = { key: string; x: number; y: number };
export class CommunityController {
  readonly api = new CommunityApi();
  readonly index = new PhotoIndex();
  readonly dialogs = new PhotoDialogs(this.api, () => {
    void this.refresh();
  });
  enabled = false;
  showMarkers = false;
  opacity = 0.65;
  private plane: HTMLButtonElement | null = null;
  private planeLabel: HTMLElement | null = null;
  renderPlane(
    root: HTMLElement,
    target: {
      key: string;
      position: { x: number; y: number; z: number };
      dynamic: boolean;
    } | null,
    origin: { x: number; y: number; z: number },
    observer: { x: number; y: number; z: number },
    project: (point: {
      x: number;
      y: number;
      z: number;
    }) => { x: number; y: number } | null,
    moving: boolean,
  ) {
    if (this.plane) this.plane.hidden = true;
    if (this.planeLabel) this.planeLabel.hidden = true;
    const photo = target ? this.index.get(target.key)?.cover : null;
    if (
      !this.enabled ||
      !this.showMarkers ||
      moving ||
      !target ||
      target.dynamic ||
      !photo?.wcs
    )
      return;
    const distance = Math.hypot(
      target.position.x - origin.x,
      target.position.y - origin.y,
      target.position.z - origin.z,
    );
    const corners = planeCorners(
      photo.wcs,
      distance,
      origin,
      observer,
      project,
    );
    const matrix = planeTransform(corners);
    if (!matrix) return;
    if (!this.plane) {
      this.plane = document.createElement("button");
      this.plane.className = "community-photo-plane";
      root.append(this.plane);
      this.planeLabel = document.createElement("span");
      this.planeLabel.className = "community-plane-credit";
      root.append(this.planeLabel);
    }
    this.plane.hidden = false;
    this.plane.style.transform = matrix;
    this.plane.style.opacity = String(this.opacity);
    if (this.plane.dataset.photo !== photo.id) {
      this.plane.dataset.photo = photo.id;
      this.plane.innerHTML = communityHtml`<img crossorigin="anonymous" src="${h(photo.image_url)}" alt="${h(photo.title)}">`;
      this.plane.onclick = () => void this.dialogs.photo(photo);
    }
    this.plane.setAttribute(
      "aria-label",
      `${photo.title} · ${photo.author.name}`,
    );
    this.planeLabel!.hidden = false;
    this.planeLabel!.textContent = `${cx("Photo, view from Earth")} · ${photo.author.name} · ${photo.licence} · ${photo.captured_at.slice(0,10)}`;
    this.planeLabel!.style.transform = `translate(${corners[0].x}px,${corners[0].y - 20}px)`;
  }
  drawFootprints(
    context: CanvasRenderingContext2D,
    project: (point: {
      x: number;
      y: number;
      z: number;
    }) => { x: number; y: number } | null,
    observerKey: string,
  ) {
    if (!this.enabled || !this.showMarkers || observerKey !== "earth") return;
    context.save();
    context.strokeStyle = "#9bdab3";
    context.lineWidth = 1;
    context.globalAlpha = this.opacity;
    const seen = new Set<string>();
    for (const frame of this.lastFrames.values())
      for (const point of frame.points) {
        const cover = this.index.get(point.key);
        const wcs = cover?.cover?.wcs;
        if (!wcs || seen.has(cover!.subject_id) || seen.size >= 24) continue;
        seen.add(cover!.subject_id);
        const corners = footprintDirections(wcs).map(project);
        if (corners.length !== 4 || corners.some((p) => !p)) continue;
        context.beginPath();
        corners.forEach((p, i) => {
          if (i === 0) context.moveTo(p!.x, p!.y);
          else context.lineTo(p!.x, p!.y);
        });
        context.closePath();
        context.stroke();
        context.font = "11px system-ui";
        context.fillStyle = "#9bdab3";
        context.fillText(
          wcs.status === "solved"
            ? cx("Plate-solved footprint")
            : cx("Author-supplied footprint"),
          corners[0]!.x + 4,
          corners[0]!.y - 4,
        );
      }
    context.restore();
  }
  private galleryKey = "";
  private photos: Photo[] = [];
  private galleryMore = false;
  private galleryRequest: AbortController | null = null;
  private galleryNode: HTMLElement | null = null;
  private generation = 0;
  private refreshing = false;
  private pendingMount: {
    host: HTMLElement;
    key: string;
    name: string;
  } | null = null;
  private readonly layers = new Map<string, HTMLElement>();
  private readonly buttons = new Map<string, Map<string, HTMLButtonElement>>();
  private lastFrames = new Map<
    string,
    { root: HTMLElement; points: Marker[]; enabled: boolean }
  >();
  constructor() {
    void this.start();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void this.refresh();
    });
    window.setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, 60_000);
    window.addEventListener("cosmic-atlas:locale-change", () => { this.localize(); this.paintGallery(); });
  }
  private localize() {
    document.querySelectorAll<HTMLElement>(".community-toggle span").forEach(e => e.textContent = ct(6));
    document.querySelectorAll<HTMLElement>("[data-community-label]").forEach(e => e.textContent = e.dataset.communityLabel === "Rankings" ? ct(7) : cx(e.dataset.communityLabel!));
    document.querySelectorAll<HTMLElement>("[data-community-account]").forEach(e => e.textContent = this.api.user?.name ?? ct(3));
    document.querySelectorAll<HTMLElement>("[data-community-review]").forEach(e => e.textContent = ct(9));
  }
  private async start() {
    try {
      const config = await this.api.request<{ enabled: boolean }>(
        "/api/community/config",
      );
      this.enabled = config.enabled;
      if (!this.enabled) return;
      document
        .querySelectorAll<HTMLElement>(".community-toggle")
        .forEach((e) => (e.hidden = false));
      const controls = document.createElement("div");
      controls.className = "community-account-actions";
      const account = document.createElement("button");
      account.dataset.communityAccount = "";
      account.textContent = ct(3);
      account.onclick = () => void this.dialogs.account();
      const rankings = document.createElement("button");
      rankings.textContent = ct(7);
      rankings.dataset.communityLabel = "Rankings";
      rankings.onclick = () => void this.rankings();
      controls.append(account, rankings);
      const coverage = document.createElement("button");
      coverage.textContent = cx("Coverage");
      coverage.dataset.communityLabel = "Coverage";
      coverage.onclick = () => void this.coverage();
      controls.append(coverage);
      const rules = document.createElement("a");
      rules.href = "/community/rules";
      rules.textContent = cx("Community rules");
      rules.dataset.communityLabel = "Community rules";
      controls.append(rules);
      document.querySelector("#controls")?.append(controls);
      const opacity = document.createElement("label");
      const opacityText = document.createElement("span");
      opacityText.dataset.communityLabel = "Photo opacity";
      opacityText.textContent = cx("Photo opacity");
      opacity.append(opacityText);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = ".05";
      slider.value = String(this.opacity);
      slider.oninput = () => (this.opacity = Number(slider.value));
      opacity.append(slider);
      controls.append(opacity);
      await this.api.session();
      account.textContent = this.api.user?.name ?? ct(3);
      const review = document.createElement("button");
      review.dataset.communityReview = "";
      review.textContent = ct(9);
      review.onclick = () => void this.review();
      controls.append(review);
      this.localize();
      await this.refresh();
      if (this.pendingMount)
        this.mount(
          this.pendingMount.host,
          this.pendingMount.key,
          this.pendingMount.name,
        );
      if (this.galleryNode) this.paintGallery();
    } catch {
      this.enabled = false;
    }
  }
  async refresh() {
    if (!this.enabled || this.refreshing) return;
    document
      .querySelectorAll<HTMLElement>("[data-community-account]")
      .forEach((e) => (e.textContent = this.api.user?.name ?? ct(3)));
    document
      .querySelectorAll<HTMLElement>("[data-community-review]")
      .forEach(
        (e) =>
          (e.hidden =
            !this.api.user ||
            !["admin", "moderator"].includes(this.api.user.role)),
      );
    this.refreshing = true;
    try {
      let more = true;
      for (let page = 0; more && page < 40; page++) {
        const data = await this.api.request<{
          items: Cover[];
          version: number;
          more: boolean;
        }>(`/api/photos/index?since=${this.index.version}`);
        this.index.apply(data.items, data.version);
        more = data.more;
      }
      for (const [mode, frame] of this.lastFrames)
        this.render(mode, frame.root, frame.points, frame.enabled);
      if (this.galleryKey) await this.loadGallery(this.galleryKey);
    } catch {
      /* Photo failures never stop scientific navigation. */
    } finally {
      this.refreshing = false;
    }
  }
  mount(host: HTMLElement, key: string, name: string) {
    this.pendingMount = { host, key, name };
    if (!this.enabled) return;
    const panel = host.querySelector<HTMLElement>(
      '[data-object-view-panel="overview"]',
    );
    if (!panel) return;
    if (
      !this.galleryNode ||
      !this.galleryNode.isConnected ||
      this.galleryKey !== key
    ) {
      this.galleryNode = document.createElement("section");
      this.galleryNode.className = "community-gallery";
      this.galleryNode.dataset.key = key;
      this.galleryNode.dataset.name = name;
      panel.prepend(this.galleryNode);
      if (this.galleryKey !== key) {
        this.galleryKey = key;
        this.photos = [];
        this.paintGallery();
        void this.loadGallery(key);
      } else this.paintGallery();
    }
  }
  private async loadGallery(key: string, append = false) {
    this.galleryRequest?.abort();
    const request = new AbortController();
    this.galleryRequest = request;
    const generation = ++this.generation;
    try {
      const result = await this.api.request<{ photos: Photo[] }>(
        `/api/objects/${encodeURIComponent(key)}/photos${append ? `?cursor=${encodeURIComponent(this.photos[this.photos.length - 1].id)}` : ""}`,
        "GET",
        undefined,
        request.signal,
      );
      if (generation !== this.generation || this.galleryKey !== key) return;
      this.photos = append
        ? [
            ...this.photos,
            ...result.photos.filter(
              (p) => !this.photos.some((old) => old.id === p.id),
            ),
          ]
        : result.photos;
      this.galleryMore =
        result.photos.length === 24 && this.photos.length < 240;
      this.paintGallery();
    } catch (error) {
      if (!request.signal.aborted && this.galleryNode) {
        this.paintGallery();
        const p = document.createElement("p");
        p.textContent = String(error);
        p.setAttribute("role", "status");
        this.galleryNode.append(p);
      }
    }
  }
  private paintGallery() {
    const node = this.galleryNode;
    if (!node) return;
    node.innerHTML = communityHtml`<div class="community-gallery-head"><div><p class="community-eyebrow">COSMIC ATLAS · COMMUNITY</p><h3>${h(ct(0))}</h3></div><button data-upload>${h(ct(1))}</button></div><div class="community-photo-grid">${this.photos.map((p) => this.card(p)).join("")}</div>${this.photos.length ? "" : communityHtml`<p class="community-empty">${h(ct(2))}</p>`}`;
    node.querySelector<HTMLButtonElement>("[data-upload]")!.onclick = () =>
      this.dialogs.upload(node.dataset.key!, node.dataset.name!);
    this.bindPhotos(node, this.photos);
    if (this.galleryMore) {
      const more = document.createElement("button");
      more.textContent = cx("Load more");
      more.onclick = () => void this.loadGallery(this.galleryKey, true);
      node.append(more);
    }
  }
  private card(p: Photo) {
    return communityHtml`<button class="community-photo-card" data-photo="${h(p.id)}"><img loading="lazy" decoding="async" src="${h(p.thumbnail_url)}" alt="${h(p.title)}"><span>${h(p.title)}</span><small>${h(p.author.name)} · ${h(p.licence)} · ${h(p.captured_at.slice(0,10))}</small></button>`;
  }
  private bindPhotos(root: HTMLElement, photos: Photo[]) {
    root.querySelectorAll<HTMLButtonElement>("[data-photo]").forEach(
      (b) =>
        (b.onclick = () => {
          const p = photos.find((p) => p.id === b.dataset.photo);
          if (p) void this.dialogs.photo(p);
        }),
    );
  }
  render(mode: string, root: HTMLElement, points: Marker[], enabled: boolean) {
    this.lastFrames.set(mode, { root, points, enabled });
    if (mode === "map") this.showMarkers = enabled;
    if (!this.enabled) return;
    let layer = this.layers.get(mode);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "community-marker-layer";
      layer.setAttribute("aria-label", ct(0));
      root.append(layer);
      this.layers.set(mode, layer);
      this.buttons.set(mode, new Map());
    }
    layer.hidden = !enabled;
    const buttons = this.buttons.get(mode)!;
    const kept = new Set<string>();
    const occupied: Marker[] = [];
    const width = root.clientWidth,
      height = root.clientHeight,
      limit = window.innerWidth < 900 ? 12 : 24;
    if (enabled)
      for (const point of points) {
        if (kept.size >= limit) break;
        const cover = this.index.get(point.key);
        if (
          !cover?.cover ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y)
        )
          continue;
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x > width - 110 ||
          point.y > height - 70 ||
          occupied.some(
            (p) =>
              Math.abs(p.x - point.x) < 115 && Math.abs(p.y - point.y) < 80,
          )
        )
          continue;
        kept.add(point.key);
        occupied.push(point);
        let button = buttons.get(point.key);
        if (!button) {
          button = document.createElement("button");
          button.className = "community-marker";
          buttons.set(point.key, button);
          layer.append(button);
        }
        const signature = JSON.stringify([
          cover.cover.id,
          cover.name,
          cover.count,
          cover.cover.author.name,
        ]);
        if (button.dataset.photo !== signature) {
          button.dataset.photo = signature;
          button.innerHTML = communityHtml`<img crossorigin="anonymous" src="${h(cover.cover.thumbnail_url)}" alt=""><span>${h(cover.name)}<small>${h(cover.cover.author.name)} · ${cover.count}</small><small>${h(cover.cover.licence)}</small><small>${h(cover.cover.captured_at.slice(0,10))}</small></span>`;
          button.setAttribute(
            "aria-label",
            `${cover.name}: ${cover.cover.title} · ${cover.cover.author.name} · ${cover.cover.licence} · ${cover.cover.captured_at.slice(0,10)}`,
          );
          button.onclick = () => void this.dialogs.photo(cover.cover!);
        }
        button.style.transform = `translate(${point.x + 12}px, ${point.y + 12}px)`;
      }
    for (const [key, button] of buttons)
      if (!kept.has(key)) {
        button.remove();
        buttons.delete(key);
      }
  }
  private async rankings() {
    const view = this.dialogs.dialog(ct(7));
    view.body.innerHTML = communityHtml`<select aria-label="Ranking period"><option value="all">All time</option><option value="trend">Trending</option><option value="photographers">Photographers</option></select><div class="community-photo-grid"></div>`;
    const select = view.body.querySelector("select")!;
    const grid = view.body.querySelector<HTMLElement>(".community-photo-grid")!;
    const load = async () => {
      try {
        if (select.value === "photographers") {
          const data = await this.api.request<{
            photographers: {
              name: string;
              handle: string;
              h_index: number;
              photos: number;
            }[];
          }>("/api/community/photographers");
          grid.innerHTML = data.photographers
            .map(
              (p) =>
                `<a href="/u/${encodeURIComponent(p.handle)}">${h(p.name)} · h ${p.h_index} · ${p.photos}</a>`,
            )
            .join("");
          return;
        }
        const data = await this.api.request<{ photos: Photo[] }>(
          `/api/community/rankings?period=${select.value}`,
        );
        if (!view.dialog.isConnected) return;
        grid.innerHTML = data.photos.map((p) => this.card(p)).join("");
        this.bindPhotos(grid, data.photos);
      } catch (e) {
        view.message.textContent = String(e);
      }
    };
    select.onchange = () => void load();
    await load();
  }
  private async review() {
    const view = this.dialogs.dialog(ct(9));
    try {
      const data = await this.api.request<{
        photos: Photo[];
        reports: { reason: string; photo: Photo }[];
      }>("/api/community/review");
      view.body.innerHTML =
        [...data.photos, ...data.reports.map((r) => r.photo)]
          .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i)
          .map(
            (p) =>
              communityHtml`<article><img class="community-full-photo" src="${h(p.image_url)}" alt="${h(p.title)}"><h3>${h(p.title)} · ${h(p.author.name)}</h3><p>${h(p.licence)}</p>${data.reports
                .filter((r) => r.photo.id === p.id)
                .map((r) => `<p>${h(r.reason)}</p>`)
                .join(
                  "",
                )}<form data-id="${h(p.id)}"><label>Reason<input name="reason" minlength="3" required></label><button name="action" value="approve">Approve</button><button name="action" value="hide">Hide</button><button name="action" value="reject">Reject</button></form></article>`,
          )
          .join("") || communityHtml`<p>No photos need review.</p>`;
      view.body.querySelectorAll<HTMLFormElement>("form").forEach(
        (form) =>
          (form.onsubmit = async (e) => {
            e.preventDefault();
            const action = (e.submitter as HTMLButtonElement)?.value;
            try {
              await this.api.request(
                `/api/community/photos/${form.dataset.id}/review`,
                "POST",
                { action, reason: new FormData(form).get("reason") },
              );
              form.parentElement!.remove();
              void this.refresh();
            } catch (e) {
              view.message.textContent = String(e);
            }
          }),
      );
      const controls = document.createElement("form");
      controls.innerHTML = communityHtml`<label>Public handle<input name="handle" required></label><label>Reason<input name="reason" minlength="3" required></label><button value="suspend">Suspend</button><button value="restore">Restore</button><button value="votes">Cancel votes</button>`;
      view.body.append(controls);
      controls.onsubmit = async (event) => {
        event.preventDefault();
        const data = new FormData(controls),
          action = (event.submitter as HTMLButtonElement).value;
        try {
          await this.api.request(
            `/api/community/users/${encodeURIComponent(String(data.get("handle")))}/${action === "votes" ? "cancel-votes" : "suspension"}`,
            "POST",
            { reason: data.get("reason"), suspended: action === "suspend" },
          );
          view.message.textContent = cx("Profile saved.");
          void this.refresh();
        } catch (e) {
          view.message.textContent = String(e);
        }
      };
    } catch (e) {
      view.message.textContent = String(e);
    }
  }
  private async coverage() {
    const view = this.dialogs.dialog(cx("Coverage"));
    try {
      const data = await this.api.request<{
        objects: { key: string; name: string; count: number }[];
      }>("/api/community/coverage");
      view.body.innerHTML = data.objects
        .map(
          (o) =>
            `<p><a href="/o/${encodeURIComponent(o.key)}">${h(o.name)}</a> · ${h(cx("No photo yet"))}</p>`,
        )
        .join("");
    } catch (e) {
      view.message.textContent = String(e);
    }
  }
}
export const community = new CommunityController();
