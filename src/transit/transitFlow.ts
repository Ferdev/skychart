import { escapeHtml as h } from "../atlasFormatting";
import { CommunityApi, errorText } from "../community/api";
import { dateTimeText, openDialog, type DialogView } from "../community/communityUi";
import { formatCount, formatDateTime, formatFixed } from "../format/quantity";
import { t } from "../i18n";
import type { PlannedTransit } from "../sky/nightPlannerModel";
import { scaledWcs, type FrameWcs, type Pixel } from "./fitsFrame";
import { lightCurveSvg, type CurveModel } from "./lightCurve";
import { MIN_COMPARISONS, MIN_FRAMES, PIPELINE_VERSION, placeStars, type GaiaStar, type LightCurve, type Placed } from "./photometry";
import type { WorkerReply, WorkerRequest } from "./transitWorker";

type TransitFit = {
  accepted: boolean;
  reasons: string[];
  mid_time_utc: string;
  uncertainty_minutes: number;
  o_minus_c_minutes: number;
  predicted_uncertainty_minutes: number;
  depth_ppt: number;
  depth_error_ppt: number;
  duration_minutes: number;
  baseline_rms_ppt: number | null;
  model: CurveModel;
};

const SOLVE_POLL_MS = 3000;
const SOLVE_POLLS = 40;
export const minutesText = (value: number, digits = 2) => t("transit.minutes", { value: formatFixed(value, digits) });
const ppt = (value: number) => t("transit.ppt", { value: formatFixed(value, 1) });
const clock = (value: string) => formatDateTime(value, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** The steps of one measurement: the frames, the star field, the worker, the fit, and the review. */
export class TransitFlow {
  private view: DialogView | null = null;
  private worker: Worker | null = null;
  private files: File[] = [];
  private instrument = "";

  constructor(private readonly api: CommunityApi, private readonly login: (after: () => void) => void) {}

  open(transit: PlannedTransit, night: string) {
    if (!this.api.user) {
      this.login(() => this.open(transit, night));
      return;
    }
    this.view = openDialog(`${t("transit.record")} · ${transit.name}`, { variant: "planner", eyebrow: night });
    this.view.dialog.addEventListener("close", () => {
      this.worker?.terminate();
      this.worker = null;
      this.view = null;
    });
    this.paintStart(transit, night);
  }

  private paintStart(transit: PlannedTransit, night: string) {
    const view = this.view!;
    view.body.innerHTML = `<form class="community-form"><p class="community-help">${h(t("transit.record.help"))}</p><p class="community-help">${h(t("transit.times", { ingress: clock(transit.ingress_utc), middle: clock(transit.mid_utc), egress: clock(transit.egress_utc) }))}</p><label class="community-field"><span>${h(t("transit.frames"))}</span><input name="frames" type="file" multiple accept=".fit,.fits,.fts,image/fits" required></label><label class="community-field"><span>${h(t("transit.instrument"))}</span><input name="instrument" maxlength="200" minlength="2" required></label><p class="community-note">${h(t("transit.notice"))}</p><div class="community-actions"><button class="primary-action">${h(t("transit.start"))}</button></div></form>`;
    const form = view.body.querySelector("form")!;
    form.onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(form);
      this.files = (data.getAll("frames") as File[]).sort((a, b) => a.name.localeCompare(b.name));
      this.instrument = String(data.get("instrument")).trim();
      if (this.files.length < MIN_FRAMES) {
        view.message.textContent = t("transit.error.fewFrames", { count: formatCount(MIN_FRAMES) });
        return;
      }
      void this.inspect(transit, night);
    };
  }

  /** Sends one request to the worker. The worker has one job at a time. */
  private ask(request: WorkerRequest, onProgress?: (current: number, total: number) => void): Promise<WorkerReply> {
    this.worker ??= new Worker(new URL("./transitWorker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve) => {
      this.worker!.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.type === "progress") onProgress?.(data.current, data.total);
        else resolve(data);
      };
      this.worker!.onerror = () => resolve({ type: "failed", code: "not_fits" });
      this.worker!.postMessage(request);
    });
  }

  /** Reads the first frame, finds the solution of the star field, and places the stars. */
  private async inspect(transit: PlannedTransit, night: string) {
    const view = this.view!;
    const fail = (key: string) => (view.message.textContent = t(key));
    view.message.textContent = t("transit.step.reading");
    const reply = await this.ask({ type: "inspect", file: this.files[0]! });
    if (reply.type !== "inspected") return fail(`transit.error.${reply.type === "failed" ? reply.code : "not_fits"}`);
    if (!reply.hasTime) return fail("transit.error.noTime");
    const canvas = document.createElement("canvas");
    canvas.width = reply.preview.width;
    canvas.height = reply.preview.height;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    reply.preview.data.forEach((value, index) => image.data.set([value, value, value, 255], index * 4));
    context.putImageData(image, 0, 0);
    let wcs = reply.wcs;
    try {
      if (!wcs) {
        view.message.textContent = t("transit.step.solving");
        wcs = await this.solve(canvas, reply.preview.scale);
      }
      if (!wcs) return;
      view.message.textContent = t("transit.step.stars");
      const reach = Math.hypot(reply.width, reply.height) * Math.hypot(wcs.cd[0], wcs.cd[2]) * 0.6;
      const { stars } = await this.api.request<{ stars: GaiaStar[] }>(`/api/transits/comparison-stars?ra=${wcs.crval[0].toFixed(5)}&dec=${wcs.crval[1].toFixed(5)}&radius=${Math.min(2, Math.max(0.05, reach)).toFixed(3)}`);
      const places = placeStars({ ra: transit.ra_deg, dec: transit.dec_deg, magnitude: transit.magnitude }, stars, reply.detections, wcs, reply.width, reply.height, reply.radius);
      if (!places.length) return fail("transit.error.targetNotFound");
      if (places.length < MIN_COMPARISONS + 1) return fail("transit.error.noComparison");
      view.message.textContent = "";
      this.paintField(canvas, places, reply.preview.scale, reply.radius, transit, night);
    } catch (error) {
      view.message.textContent = errorText(error);
    }
  }

  /** A frame with no solution in its header goes to the plate solver as one small gray image. */
  private async solve(canvas: HTMLCanvasElement, scale: number): Promise<FrameWcs | null> {
    const view = this.view!;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    let binary = "";
    new Uint8Array(await blob.arrayBuffer()).forEach((byte) => (binary += String.fromCharCode(byte)));
    const queued = await this.api.request<{ id: string }>("/api/community/transits/frames", "POST", { image_base64: btoa(binary) });
    for (let attempt = 0; attempt < SOLVE_POLLS && view.dialog.isConnected; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, SOLVE_POLL_MS));
      const state = await this.api.request<{ status: string; wcs?: { ra_deg: number; dec_deg: number; cd: [number, number, number, number]; crpix: [number, number] } | null }>(`/api/community/transits/frames/${queued.id}`);
      if (state.status === "solved" && state.wcs) return scaledWcs({ crval: [state.wcs.ra_deg, state.wcs.dec_deg], crpix: state.wcs.crpix, cd: state.wcs.cd }, scale);
      if (state.status === "failed") break;
    }
    view.message.textContent = t("transit.error.solveFailed");
    return null;
  }

  private paintField(canvas: HTMLCanvasElement, places: Placed[], scale: number, radius: number, transit: PlannedTransit, night: string) {
    const view = this.view!;
    const context = canvas.getContext("2d")!;
    context.lineWidth = 2;
    for (const place of places) {
      context.strokeStyle = place.role === "target" ? "#82cbb3" : "#ffffff";
      context.beginPath();
      context.arc(place.x / scale, place.y / scale, Math.max(6, (radius * 1.5) / scale), 0, 2 * Math.PI);
      context.stroke();
    }
    view.body.innerHTML = `<h3>${h(t("transit.field.check"))}</h3><p class="community-help">${h(t("transit.field.help", { count: formatCount(places.length - 1) }))}</p><div class="transit-field"></div><div class="community-actions"><button type="button" class="primary-action" data-measure>${h(t("transit.field.continue"))}</button></div>`;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("transit.field.check"));
    view.body.querySelector(".transit-field")!.append(canvas);
    view.body.querySelector<HTMLButtonElement>("[data-measure]")!.onclick = () => void this.measure(places, radius, transit, night);
  }

  private async measure(places: Placed[], radius: number, transit: PlannedTransit, night: string) {
    const view = this.view!;
    view.body.querySelector<HTMLButtonElement>("[data-measure]")!.disabled = true;
    const reply = await this.ask({ type: "measure", files: this.files, places: places.map(({ x, y }: Pixel) => ({ x, y })), radius }, (current, total) => {
      view.message.textContent = t("transit.step.measuring", { current: formatCount(current), total: formatCount(total) });
    });
    if (reply.type !== "measured") {
      view.message.textContent = t("transit.error.not_fits");
      return;
    }
    if (reply.frames < MIN_FRAMES) {
      view.message.textContent = t("transit.error.fewFrames", { count: formatCount(MIN_FRAMES) });
      return;
    }
    view.message.textContent = t("transit.step.fitting");
    try {
      const fit = await this.api.request<TransitFit>("/api/community/transits/fit", "POST", { key: transit.key, points: reply.curve.points });
      view.message.textContent = "";
      this.paintResult(fit, reply.curve, places.length - 1, transit, night);
    } catch (error) {
      view.message.textContent = errorText(error);
    }
  }

  private paintResult(fit: TransitFit, curve: LightCurve, comparisons: number, transit: PlannedTransit, night: string) {
    const view = this.view!;
    const facts: [string, string][] = [
      [t("transit.result.mid"), dateTimeText(fit.mid_time_utc)],
      [t("transit.result.uncertainty"), `± ${minutesText(fit.uncertainty_minutes)}`],
      [t("transit.result.oc"), `${minutesText(fit.o_minus_c_minutes)} (± ${minutesText(fit.predicted_uncertainty_minutes)})`],
      [t("transit.result.depth"), ppt(fit.depth_ppt)],
      [t("transit.result.duration"), minutesText(fit.duration_minutes, 0)],
      [t("transit.result.frames"), formatCount(curve.points.length)],
      [t("transit.result.dropped"), formatCount(curve.dropped)],
      ...(fit.baseline_rms_ppt === null ? [] : [[t("transit.result.baseline"), ppt(fit.baseline_rms_ppt)] as [string, string]]),
      ...(curve.checkRmsPpt === null ? [] : [[t("transit.result.comparison"), ppt(curve.checkRmsPpt)] as [string, string]]),
    ];
    const problems = fit.reasons.map((reason) => `<li>${h(t(`transit.reason.${reason}`))}</li>`).join("");
    view.body.innerHTML = `<h3>${h(t("transit.curve.title"))}</h3>${lightCurveSvg(curve.points, fit.model, t("transit.curve.caption", { name: transit.name }))}<dl class="community-facts">${facts.map(([label, value]) => `<dt>${h(label)}</dt><dd>${h(value)}</dd>`).join("")}</dl>${fit.accepted ? `<p class="community-note">${h(t("transit.notice"))}</p><div class="community-actions"><button type="button" class="primary-action" data-send>${h(t("transit.submit"))}</button></div>` : `<div class="community-note community-note--warning"><strong>${h(t("transit.notAccepted"))}</strong><ul>${problems}</ul></div>`}`;
    const send = view.body.querySelector<HTMLButtonElement>("[data-send]");
    if (!send) return;
    send.onclick = async () => {
      send.disabled = true;
      try {
        await this.api.request("/api/community/transits", "POST", {
          key: transit.key,
          host_key: transit.host_key,
          name: transit.name,
          status: transit.status,
          night,
          instrument: this.instrument,
          points: curve.points,
          frame_count: curve.points.length + curve.dropped,
          frames_dropped: curve.dropped,
          comparison: { count: comparisons, check_rms_ppt: curve.checkRmsPpt },
          pipeline_version: PIPELINE_VERSION,
        });
        view.body.innerHTML = `<div class="community-empty"><p>${h(t("transit.submitted"))}</p></div>`;
      } catch (error) {
        send.disabled = false;
        view.message.textContent = errorText(error);
      }
    };
  }
}
