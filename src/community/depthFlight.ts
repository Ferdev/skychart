import { canvasFont } from "../format/fonts";
import { trackEvent } from "../analytics";
import { formatCount, formatLightYears, formatQuantity } from "../format/quantity";
import { t } from "../i18n";
import { CommunityApi, errorText, type Photo } from "./api";
import { h, licenceText, openDialog, type DialogView } from "./communityUi";
import { cameraDistance, depthSpan, place, sourceAt, type DepthLayers } from "./depthFlightModel";

const FLIGHT_MS = 14_000;
const CLIP_BITS = 6_000_000;
const SELECT_REACH = 0.02;
const VIEW_WIDTH = 960;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

/** The flight through one photo: a canvas that a person can watch, stop, look around in, and record. */
export class DepthFlight {
  private view: DialogView | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private progress = 0;
  private playing = false;
  private lookX = 0;
  private lookY = 0;
  private layers: DepthLayers | null = null;
  private base: HTMLImageElement | null = null;
  private sprites: HTMLImageElement | null = null;

  constructor(private readonly api: CommunityApi, private readonly openObject: (key: string) => void) {}

  async open(photo: Photo) {
    const view = openDialog(t("depth.title"), { variant: "viewer", eyebrow: photo.title });
    this.view = view;
    view.dialog.addEventListener("close", () => {
      cancelAnimationFrame(this.frame);
      this.playing = false;
      this.view = null;
    });
    view.message.textContent = t("community.loading");
    try {
      this.layers = await this.api.request<DepthLayers>(`/api/photos/${photo.id}/depth`);
      [this.base, this.sprites] = await Promise.all([loadImage(this.layers.base_url), loadImage(this.layers.sprites_url)]);
    } catch (error) {
      view.message.textContent = errorText(error);
      return;
    }
    if (!view.dialog.isConnected) return;
    view.message.textContent = "";
    trackEvent("depth_flight", { photo: photo.id });
    this.paint();
  }

  private paint() {
    const view = this.view!;
    const layers = this.layers!;
    const span = depthSpan(layers);
    const stops = [
      [t("depth.nearest"), span.nearest.name, span.nearest.distance_ly],
      [t("depth.farthest"), span.farthest.name, span.farthest.distance_ly],
    ] as const;
    view.body.innerHTML = `<div class="depth-flight"><div class="depth-flight__stage"><canvas width="${VIEW_WIDTH}" height="${Math.round((VIEW_WIDTH * layers.height) / layers.width)}" tabindex="0" aria-label="${h(t("depth.canvas", { title: layers.credit.title }))}"></canvas></div><label class="depth-flight__ruler"><span>${h(t("depth.position"))}</span><input type="range" min="0" max="1" step="0.001" value="0" data-progress></label><p class="community-help" data-distance aria-live="off"></p><dl class="community-facts">${stops.map(([label, name, distance]) => `<dt>${h(label)}</dt><dd>${h(name)} · ${h(formatLightYears(distance))} · ${h(t("depth.lightTime", { years: formatQuantity(distance) }))}</dd>`).join("")}<dt>${h(t("depth.matched"))}</dt><dd>${h(t("depth.matchedValue", { matched: formatCount(layers.sources.length), detected: formatCount(layers.detected) }))}</dd></dl><p class="community-note">${h(t("depth.note"))}</p><div class="community-actions community-actions--wrap"><button type="button" class="primary-action" data-play>${h(t("depth.play"))}</button><button type="button" class="secondary-action" data-clip>${h(t("depth.saveClip"))}</button></div></div>`;
    this.canvas = view.body.querySelector("canvas")!;
    const slider = view.body.querySelector<HTMLInputElement>("[data-progress]")!;
    const play = view.body.querySelector<HTMLButtonElement>("[data-play]")!;
    slider.oninput = () => {
      this.playing = false;
      this.progress = Number(slider.value);
      play.textContent = t("depth.play");
      this.draw();
    };
    play.onclick = () => (this.playing ? this.stop() : this.fly());
    view.body.querySelector<HTMLButtonElement>("[data-clip]")!.onclick = () => void this.saveClip();
    this.bindLook();
    this.draw();
  }

  private bindLook() {
    const canvas = this.canvas!;
    let start: { x: number; y: number; lookX: number; lookY: number } | null = null;
    let moved = false;
    canvas.onpointerdown = (event) => {
      start = { x: event.clientX, y: event.clientY, lookX: this.lookX, lookY: this.lookY };
      moved = false;
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = (event) => {
      if (!start) return;
      const box = canvas.getBoundingClientRect();
      moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
      this.lookX = start.lookX + (event.clientX - start.x) / box.width;
      this.lookY = start.lookY + (event.clientY - start.y) / box.height;
      if (!this.playing) this.draw();
    };
    canvas.onpointerup = (event) => {
      if (!moved) this.select(event);
      start = null;
    };
    canvas.onkeydown = (event) => {
      const step = { ArrowLeft: [0.03, 0], ArrowRight: [-0.03, 0], ArrowUp: [0, 0.03], ArrowDown: [0, -0.03] }[event.key];
      if (!step) return;
      event.preventDefault();
      this.lookX += step[0]!;
      this.lookY += step[1]!;
      if (!this.playing) this.draw();
    };
  }

  private select(event: PointerEvent) {
    const layers = this.layers!;
    const box = this.canvas!.getBoundingClientRect();
    const span = depthSpan(layers);
    const camera = cameraDistance(this.progress, span.nearest.distance_ly, span.high);
    const source = sourceAt(layers.sources, camera, (event.clientX - box.left) / box.width - this.lookX, (event.clientY - box.top) / box.height - this.lookY, SELECT_REACH);
    if (source) {
      this.view?.dialog.close();
      this.openObject(source.key);
    }
  }

  private fly(onEnd?: () => void) {
    const play = this.view!.body.querySelector<HTMLButtonElement>("[data-play]")!;
    const slider = this.view!.body.querySelector<HTMLInputElement>("[data-progress]")!;
    this.playing = true;
    play.textContent = t("depth.pause");
    if (this.progress >= 1) this.progress = 0;
    const first = this.progress;
    const began = performance.now();
    const step = (now: number) => {
      if (!this.playing || !this.view) return;
      this.progress = Math.min(1, first + (now - began) / FLIGHT_MS);
      slider.value = String(this.progress);
      this.draw();
      if (this.progress < 1) this.frame = requestAnimationFrame(step);
      else {
        this.stop();
        onEnd?.();
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  private stop() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    const play = this.view?.body.querySelector<HTMLButtonElement>("[data-play]");
    if (play) play.textContent = t("depth.play");
  }

  /**
   * The base and the sprites add their light, as a photo does. The sum at the start is the
   * photo, for each order of the layers and for each depth.
   */
  private draw() {
    const canvas = this.canvas;
    const layers = this.layers;
    if (!canvas || !layers || !this.base || !this.sprites) return;
    const context = canvas.getContext("2d")!;
    const { width, height } = canvas;
    const span = depthSpan(layers);
    const camera = cameraDistance(this.progress, span.nearest.distance_ly, span.high);
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    const plane = place(0, 0, layers.plane_distance_ly, camera);
    if (plane) {
      context.globalAlpha = plane.alpha;
      context.drawImage(this.base, (plane.x + this.lookX) * width, (plane.y + this.lookY) * height, width * plane.scale, height * plane.scale);
    }
    const cell = layers.cell;
    const shown = width / layers.width;
    for (const source of layers.sources) {
      const point = place(source.x, source.y, source.distance_ly, camera);
      if (!point) continue;
      const size = cell * shown * point.scale;
      context.globalAlpha = point.alpha;
      context.drawImage(this.sprites, source.cell[0] * cell, source.cell[1] * cell, cell, cell, (point.x + this.lookX) * width - size / 2, (point.y + this.lookY) * height - size / 2, size, size);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.font = canvasFont(14);
    context.fillStyle = "rgba(0,0,0,0.55)";
    const credit = t("depth.credit", { name: layers.credit.name, licence: licenceText(layers.credit.licence) });
    context.fillRect(0, height - 26, Math.min(width, context.measureText(credit).width + 16), 26);
    context.fillStyle = "#fff";
    context.fillText(credit, 8, height - 8);
    if (plane) context.fillText(t("depth.plane", { distance: formatLightYears(layers.plane_distance_ly) }), 8, 20);
    const label = this.view?.body.querySelector<HTMLElement>("[data-distance]");
    if (label) label.textContent = t("depth.camera", { distance: formatLightYears(camera) });
  }

  /** Records one guided flight from this canvas. The credit is a part of each frame. */
  private async saveClip() {
    const view = this.view!;
    const button = view.body.querySelector<HTMLButtonElement>("[data-clip]")!;
    const type = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find((item) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(item));
    if (!type || !this.canvas?.captureStream) {
      view.message.textContent = t("depth.clipUnavailable");
      return;
    }
    button.disabled = true;
    view.message.textContent = t("depth.recording");
    this.stop();
    this.progress = 0;
    this.lookX = this.lookY = 0;
    this.draw();
    const recorder = new MediaRecorder(this.canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: CLIP_BITS });
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => parts.push(event.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start();
    this.fly(() => recorder.stop());
    await done;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(parts, { type }));
    link.download = `${this.layers!.credit.title.replace(/[^\p{L}\p{N}]+/gu, "-")}-depth.${type.includes("mp4") ? "mp4" : "webm"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    button.disabled = false;
    if (this.view) view.message.textContent = t("depth.clipSaved");
    trackEvent("depth_clip", { photo: this.layers!.photo_id });
  }
}
