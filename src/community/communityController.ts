import { footprintDirections } from "./photoFootprint";
import { canvasFont } from "../format/fonts";
import { formatCount } from "../format/quantity";
import { t } from "../i18n";
import { CommunityApi, errorText, type OverlayPhoto, type Photo, type Cover } from "./api";
import { CommunityHub, type HubTab } from "./communityHub";
import type { TourBuilderHost } from "./tourBuilder";
import { dateText, emptyState, h, licenceText, photoCard } from "./communityUi";
import { PhotoIndex } from "./photoIndex";
import { PhotoDialogs, type DialogHost } from "./photoDialogs";
import { planeCorners, planeTransform } from "./photoPlane";
import { overlayArea, overlayPlacements, quadContains, type OverlayArea, type OverlayPlacement } from "./photoOverlay";
import type { SkyCamera } from "../sky/skyProjection";
type Marker = { key: string; x: number; y: number };
/** Size of a map card and the free space around it, for the overlap test. */
const MARKER_WIDTH = 168;
const MARKER_HEIGHT = 52;
/** The teal of the interface (`--spectral-teal`), for the footprint lines on the Sky canvas. */
const FOOTPRINT_COLOR = "#82cbb3";
const OVERLAY_RETRY_MS = 30_000;
export class CommunityController {
  readonly api = new CommunityApi();
  readonly index = new PhotoIndex();
  /**
   * Selects an object in the atlas. `main.ts` sets it when the atlas is ready.
   * Without it, the link goes to the object page.
   */
  selectObject: ((key: string) => Promise<void> | void) | null = null;
  private readonly host: DialogHost = {
    openObject: (key) => this.openObject(key),
    openPhotographer: (handle) => this.hub.open("photographers", { handle }),
  };
  readonly dialogs = new PhotoDialogs(this.api, () => {
    void this.refresh();
    this.hub.refresh();
  });
  /** The tour builder works with the atlas through these two functions, which `main.ts` sets. */
  readonly tours: TourBuilderHost = { captureView: null, preview: null };
  readonly hub: CommunityHub = new CommunityHub(this.api, this.dialogs, () => void this.refresh(), this.host, this.tours);
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
      this.plane.innerHTML = `<img crossorigin="anonymous" src="${h(photo.image_url)}" alt="${h(photo.title)}">`;
      this.plane.onclick = () => void this.dialogs.photo(photo);
    }
    this.plane.setAttribute(
      "aria-label",
      `${photo.title} · ${photo.author.name}`,
    );
    this.planeLabel!.hidden = false;
    this.planeLabel!.textContent = `${t("community.plane.label")} · ${photo.author.name} · ${licenceText(photo.licence)} · ${dateText(photo.captured_at)}`;
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
    context.strokeStyle = FOOTPRINT_COLOR;
    context.lineWidth = 1;
    context.globalAlpha = this.opacity;
    const seen = new Set<string>();
    for (const frame of this.lastFrames.values())
      for (const point of frame.points) {
        const cover = this.index.get(point.key);
        const wcs = cover?.cover?.wcs;
        // A solver solution is on the Sky overlay, with the viewer behind it.
        if (!wcs || wcs.status === "solved" || seen.has(cover!.subject_id) || seen.size >= 24) continue;
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
        context.font = canvasFont(12);
        context.fillStyle = FOOTPRINT_COLOR;
        context.fillText(
          t(wcs.status === "solved" ? "community.footprint.solved" : "community.footprint.author"),
          corners[0]!.x + 4,
          corners[0]!.y - 4,
        );
      }
    context.restore();
  }
  /** Sky view repaints when this is set: a new overlay response, a new opacity, or a new state of the layer. */
  overlayChanged: (() => void) | null = null;
  private overlayLayer: HTMLElement | null = null;
  private readonly overlayImages = new Map<string, HTMLElement>();
  private readonly overlayCache = new Map<string, OverlayPhoto[]>();
  private overlayKey = "";
  private overlayRequest: AbortController | null = null;
  private overlayVersion = -1;
  private overlayRetryAt = 0;
  private overlayPlaced: OverlayPlacement[] = [];

  /** The photos layer of the Sky view filters. `main.ts` sets it, because the layer is part of the view state. */
  skyLayerChanged: ((shown: boolean) => void) | null = null;
  private skyLayerToggle: HTMLInputElement | null = null;

  setSkyLayer(shown: boolean) {
    this.skyLayerShown = shown;
    if (this.skyLayerToggle) this.skyLayerToggle.checked = shown;
  }
  private skyLayerShown = false;

  /** The layer switch and the opacity control of the Sky view filters, with the community on. */
  private buildSkyControls(mapSlider: HTMLInputElement) {
    const after = document.querySelector("#sky-constellations-toggle")?.closest("label");
    if (!after) return null;
    const toggle = document.createElement("label");
    toggle.className = "sky-view__filter";
    toggle.innerHTML = `<input id="sky-photos-toggle" type="checkbox"><span data-i18n="community.layer">${h(t("community.layer"))}</span>`;
    const input = toggle.querySelector("input")!;
    input.checked = this.skyLayerShown;
    input.onchange = () => this.skyLayerChanged?.(input.checked);
    this.skyLayerToggle = input;
    const control = document.createElement("label");
    control.className = "community-sky-opacity";
    control.innerHTML = `<span data-i18n="community.opacity">${h(t("community.opacity"))}</span><input id="sky-photo-opacity" type="range" min="0" max="1" step="0.05" value="${mapSlider.value}">`;
    after.after(toggle, control);
    return control.querySelector("input");
  }

  /** The aligned images and the footprints of the Sky overlay. The photos stay in the view from Earth. */
  renderSkyOverlay(context: CanvasRenderingContext2D, root: HTMLElement, camera: SkyCamera, width: number, height: number, observerKey: string) {
    const shown = this.enabled && this.showMarkers && observerKey === "earth";
    if (shown) this.requestOverlay(overlayArea(camera, width, height));
    const photos = shown ? this.overlayCache.get(this.overlayKey) ?? [] : [];
    this.overlayPlaced = overlayPlacements(photos, camera, width, height);
    this.paintOverlayImages(root);
    if (!this.overlayPlaced.length) return;
    context.save();
    context.strokeStyle = FOOTPRINT_COLOR;
    context.fillStyle = FOOTPRINT_COLOR;
    context.lineWidth = 1;
    context.globalAlpha = Math.max(0.35, this.opacity);
    context.font = canvasFont(12);
    for (const place of this.overlayPlaced) {
      context.beginPath();
      place.corners.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
      context.closePath();
      context.stroke();
      if (place.labelled) context.fillText(t("community.footprint.solved"), place.corners[3].x + 4, place.corners[3].y - 4);
    }
    context.restore();
  }

  /** A click on the sky with no object: the smallest footprint at that place opens the photo viewer. */
  openFootprintAt(point: { x: number; y: number }) {
    const place = [...this.overlayPlaced].reverse().find((item) => quadContains(item.corners, point));
    if (place) this.openOverlayPhoto(place.photo.id);
  }

  private openOverlayPhoto(id: string) {
    void this.api.request<Photo>(`/api/photos/${encodeURIComponent(id)}`).then((photo) => this.dialogs.photo(photo)).catch(() => undefined);
  }

  /** The area changes in steps, so a small movement of the view makes no request. */
  private requestOverlay(area: OverlayArea) {
    if (area.key === this.overlayKey && (this.overlayCache.has(area.key) || this.overlayRequest)) return;
    // A failed request must not repeat with each frame of a movement.
    if (Date.now() < this.overlayRetryAt) return;
    this.overlayRequest?.abort();
    this.overlayRequest = null;
    this.overlayKey = area.key;
    if (this.overlayCache.has(area.key)) return;
    const request = new AbortController();
    this.overlayRequest = request;
    void this.api
      .request<{ photos: OverlayPhoto[] }>(`/api/photos/sky?ra=${area.ra}&dec=${area.dec}&radius=${area.radius}`, "GET", undefined, request.signal)
      .then((data) => {
        if (this.overlayCache.size >= 16) this.overlayCache.clear();
        this.overlayCache.set(area.key, data.photos);
        this.overlayChanged?.();
      })
      .catch(() => {
        /* Photo failures never stop scientific navigation. */
        if (!request.signal.aborted) this.overlayRetryAt = Date.now() + OVERLAY_RETRY_MS;
      })
      .finally(() => {
        if (this.overlayRequest === request) this.overlayRequest = null;
      });
  }

  private paintOverlayImages(root: HTMLElement) {
    if (!this.overlayLayer && !this.overlayPlaced.length) return;
    if (!this.overlayLayer) {
      this.overlayLayer = document.createElement("div");
      this.overlayLayer.className = "community-sky-overlay";
      root.querySelector("canvas")?.after(this.overlayLayer);
    }
    const kept = new Set<string>();
    for (const place of this.overlayPlaced) {
      if (!place.image && !place.focusable) continue;
      kept.add(place.photo.id);
      let element = this.overlayImages.get(place.photo.id);
      if (!element) {
        element = document.createElement("div");
        element.innerHTML = `<button type="button" class="community-sky-photo__focus">${h(`${place.photo.title} · ${place.photo.author}`)}</button>`;
        element.querySelector("button")!.onclick = () => this.openOverlayPhoto(place.photo.id);
        this.overlayLayer.append(element);
        this.overlayImages.set(place.photo.id, element);
      }
      const center = place.center;
      element.className = "community-sky-photo";
      element.querySelector<HTMLElement>(".community-sky-photo__focus")!.style.transform = `translate(${Math.round(center.x)}px,${Math.round(center.y)}px)`;
      const matrix = place.image ? planeTransform(place.corners) : null;
      let image = element.querySelector("img");
      if (!matrix) {
        image?.remove();
        continue;
      }
      if (!image) {
        image = document.createElement("img");
        image.crossOrigin = "anonymous";
        image.alt = "";
        image.decoding = "async";
        element.prepend(image);
      }
      const source = place.size > 320 ? place.photo.image_url : place.photo.thumbnail_url;
      if (image.getAttribute("src") !== source) image.src = source;
      image.style.transform = matrix;
      image.style.opacity = String(this.opacity);
    }
    for (const [id, element] of this.overlayImages)
      if (!kept.has(id)) {
        element.remove();
        this.overlayImages.delete(id);
      }
  }

  private galleryKey = "";
  private photos: Photo[] = [];
  private galleryMore = false;
  private galleryError = "";
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
    this.dialogs.host = this.host;
    void this.start();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void this.refresh();
    });
    window.setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, 60_000);
    window.addEventListener("cosmic-atlas:locale-change", () => {
      this.paintAccount();
      this.paintGallery();
      this.hub.refresh();
      // The cards on the map have a date and a licence name in the application language.
      for (const buttons of this.buttons.values()) for (const button of buttons.values()) delete button.dataset.photo;
      for (const [mode, frame] of this.lastFrames) this.render(mode, frame.root, frame.points, frame.enabled);
    });
  }
  /** Shows the object in the atlas, and closes the community windows that are on top of the map. */
  private openObject(key: string) {
    document.querySelectorAll<HTMLDialogElement>("dialog.community-dialog").forEach((dialog) => dialog.close());
    if (this.selectObject) void this.selectObject(key);
    else window.location.assign(`/o/${encodeURIComponent(key)}`);
  }
  /** The report form of a shared tour. A report closes the player, because the tour is on hold for a moderator. */
  reportTour(slug: string, closePlayer: () => void) {
    this.dialogs.reasonForm(t("community.report"), t("community.sendReport"), t("community.tours.report.help"), async (reason) => {
      await this.api.request(`/api/community/shared-tours/${encodeURIComponent(slug.replace(/^shared-/, ""))}/report`, "POST", { reason });
      closePlayer();
    });
  }
  /** The account button shows the name of the signed-in person. The review button is for moderators. */
  private paintAccount() {
    document.querySelectorAll<HTMLElement>("[data-community-account]").forEach((element) => {
      element.textContent = this.api.user?.name ?? t("community.signIn");
    });
    document.querySelectorAll<HTMLElement>("[data-community-review]").forEach((element) => {
      element.hidden = !this.api.moderator;
      const count = element.querySelector<HTMLElement>(".community-count")!;
      count.hidden = this.api.reviewCount === 0;
      count.textContent = formatCount(this.api.reviewCount);
      count.setAttribute("aria-label", t("community.pending", { count: formatCount(this.api.reviewCount) }));
    });
  }
  /**
   * The community row of the header card. It has the same buttons as the time bar above it.
   * Below 900 px the header has little space, so one button opens the row as a menu.
   */
  private buildBar() {
    const bar = document.createElement("nav");
    bar.className = "community-bar";
    bar.dataset.i18nAttrs = "aria-label:community.nav.label";
    bar.setAttribute("aria-label", t("community.nav.label"));
    bar.innerHTML = `<button type="button" class="community-menu-toggle" aria-expanded="false" aria-controls="community-menu" data-i18n="community.nav.menu">${h(t("community.nav.menu"))}</button><div class="community-menu" id="community-menu"><span class="community-bar__label" data-i18n="community.title">${h(t("community.title"))}</span>${(
      [
        ["gallery", "community.tab.gallery"],
        ["photographers", "community.tab.photographers"],
        ["coverage", "community.tab.coverage"],
        ["rules", "community.tab.rules"],
      ] as [HubTab, string][]
    )
      .map(([tab, key]) => `<button type="button" data-community-tab="${tab}" data-i18n="${key}">${h(t(key))}</button>`)
      .join("")}<span class="community-bar__space"></span><button type="button" data-community-review hidden><span data-i18n="community.review">${h(t("community.review"))}</span> <span class="community-count" hidden></span></button><button type="button" data-community-account>${h(t("community.signIn"))}</button></div>`;
    const toggle = bar.querySelector<HTMLButtonElement>(".community-menu-toggle")!;
    const menu = bar.querySelector<HTMLElement>(".community-menu")!;
    const setOpen = (open: boolean) => {
      bar.toggleAttribute("data-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.onclick = () => setOpen(!bar.hasAttribute("data-open"));
    menu.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) setOpen(false);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!bar.contains(event.target as Node)) setOpen(false);
    });
    bar.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && bar.hasAttribute("data-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    menu.querySelectorAll<HTMLButtonElement>("[data-community-tab]").forEach(
      (button) => (button.onclick = () => this.hub.open(button.dataset.communityTab as HubTab)),
    );
    menu.querySelector<HTMLButtonElement>("[data-community-review]")!.onclick = () => this.hub.open("review");
    menu.querySelector<HTMLButtonElement>("[data-community-account]")!.onclick = () => {
      if (this.api.user) this.hub.open("account");
      else this.dialogs.login(() => this.hub.open("account"));
    };
    document.querySelector(".atlas-bar")?.append(bar);
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
      this.buildBar();
      const opacity = document.createElement("label");
      opacity.className = "community-opacity";
      opacity.innerHTML = `<span data-i18n="community.opacity">${h(t("community.opacity"))}</span>`;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = ".05";
      slider.value = String(this.opacity);
      opacity.append(slider);
      document.querySelector("#scale-map-overlays")?.append(opacity);
      const skySlider = this.buildSkyControls(slider);
      for (const input of [slider, skySlider]) {
        if (!input) continue;
        input.oninput = () => {
          this.opacity = Number(input.value);
          slider.value = input.value;
          if (skySlider) skySlider.value = input.value;
          this.overlayChanged?.();
        };
      }
      await this.api.session();
      this.paintAccount();
      await this.refresh();
      // Sky view can be open from the start of the page, before the community is on.
      this.overlayChanged?.();
      if (this.pendingMount)
        this.mount(
          this.pendingMount.host,
          this.pendingMount.key,
          this.pendingMount.name,
        );
      if (this.galleryNode) this.paintGallery();
      this.openAddress();
    } catch {
      this.enabled = false;
    }
  }
  /** The address of a photo page or of a photographer page opens its window on top of the atlas. */
  private openAddress() {
    const photo = /^\/photos\/([0-9a-f-]{36})\/?$/i.exec(window.location.pathname);
    const person = /^\/u\/([a-z][a-z0-9-]{2,39})\/?$/.exec(window.location.pathname);
    if (photo)
      void this.api
        .request<Photo>(`/api/photos/${photo[1]}`)
        .then((data) => this.dialogs.photo(data))
        .catch(() => undefined);
    else if (person) this.hub.open("photographers", { handle: person[1] });
  }
  async refresh() {
    if (!this.enabled || this.refreshing) return;
    this.paintAccount();
    this.refreshing = true;
    try {
      // A moderator gets the new count of waiting photos with each refresh.
      if (this.api.moderator) {
        await this.api.session();
        this.paintAccount();
      }
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
      // A takedown changes the index version, so the overlay asks the server again.
      if (this.overlayVersion !== this.index.version) {
        this.overlayVersion = this.index.version;
        this.overlayCache.clear();
        this.overlayKey = "";
        this.overlayChanged?.();
      }
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
      // A section of the object inspector, with the heading and the cards of the other sections.
      this.galleryNode = document.createElement("section");
      this.galleryNode.className = "data-section community-gallery";
      this.galleryNode.dataset.key = key;
      this.galleryNode.dataset.name = name;
      // The community photos follow the curated images of the object.
      const media = panel.querySelector(":scope > .object-media-section");
      if (media) media.after(this.galleryNode);
      else panel.prepend(this.galleryNode);
      if (this.galleryKey !== key) {
        this.galleryKey = key;
        this.photos = [];
        this.galleryError = "";
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
      this.galleryError = "";
      this.paintGallery();
    } catch (error) {
      if (!request.signal.aborted && this.galleryNode) {
        this.galleryError = errorText(error);
        this.paintGallery();
      }
    }
  }
  private paintGallery() {
    const node = this.galleryNode;
    if (!node) return;
    node.innerHTML = `<div class="community-gallery__head"><h3>${h(t("community.title"))}${this.photos.length ? ` <span class="community-count">${h(formatCount(this.photos.length))}</span>` : ""}</h3><button type="button" class="secondary-action" data-upload>${h(t("community.publish"))}</button></div>${
      this.photos.length
        ? `<div class="community-photo-grid">${this.photos.map((photo) => photoCard(photo)).join("")}</div>`
        : emptyState(t("community.gallery.empty"))
    }${this.galleryError ? `<p class="community-message" role="status">${h(this.galleryError)}</p>` : ""}`;
    node.querySelector<HTMLButtonElement>("[data-upload]")!.onclick = () =>
      this.dialogs.upload(node.dataset.key!, node.dataset.name!);
    const photos = this.photos;
    node.querySelectorAll<HTMLButtonElement>("[data-photo]").forEach(
      (button) =>
        (button.onclick = () => {
          const photo = photos.find((item) => item.id === button.dataset.photo);
          if (photo) void this.dialogs.photo(photo, photos);
        }),
    );
    if (this.galleryMore) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "text-action";
      more.textContent = t("community.loadMore");
      more.onclick = () => void this.loadGallery(this.galleryKey, true);
      node.append(more);
    }
  }
  render(mode: string, root: HTMLElement, points: Marker[], enabled: boolean) {
    this.lastFrames.set(mode, { root, points, enabled });
    if (mode === "map") this.showMarkers = enabled;
    if (!this.enabled) return;
    let layer = this.layers.get(mode);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "community-marker-layer";
      layer.dataset.i18nAttrs = "aria-label:community.title";
      layer.setAttribute("aria-label", t("community.title"));
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
          point.x > width - MARKER_WIDTH ||
          point.y > height - MARKER_HEIGHT - 18 ||
          occupied.some(
            (p) =>
              Math.abs(p.x - point.x) < MARKER_WIDTH + 6 && Math.abs(p.y - point.y) < MARKER_HEIGHT + 10,
          )
        )
          continue;
        kept.add(point.key);
        occupied.push(point);
        let button = buttons.get(point.key);
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
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
          button.innerHTML = `<img crossorigin="anonymous" src="${h(cover.cover.thumbnail_url)}" alt=""><span class="community-marker__text"><strong>${h(cover.name)}</strong><small>${h(cover.cover.author.name)}</small></span>${cover.count > 1 ? `<span class="community-count">${h(formatCount(cover.count))}</span>` : ""}`;
          button.setAttribute(
            "aria-label",
            `${cover.name}: ${cover.cover.title} · ${cover.cover.author.name} · ${licenceText(cover.cover.licence)} · ${dateText(cover.cover.captured_at)} · ${t("community.photoCount", { count: formatCount(cover.count) })}`,
          );
          button.onclick = () => void this.dialogs.photo(cover.cover!);
        }
        button.style.transform = `translate(${Math.round(point.x + 12)}px, ${Math.round(point.y + 12)}px)`;
      }
    for (const [key, button] of buttons)
      if (!kept.has(key)) {
        button.remove();
        buttons.delete(key);
      }
  }
}
export const community = new CommunityController();
