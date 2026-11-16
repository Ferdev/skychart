import { objectMediaItemsFor, pixelBufferHasVisibleVariation, type ObjectMediaItem, type ObjectMediaFallback } from "../objectMedia";
import { trackAnalytics } from "../analytics";

const cleanups = new WeakMap<HTMLElement, () => void>();

/** Uses the existing survey-image proxy, provider metadata and honest AllWISE fallback. */
export function mountSurveyFlight(root: HTMLElement, step: number, signal: AbortSignal, context?: () => string) {
  cleanups.get(root)?.();
  root.querySelector("[data-survey-flight]")?.remove();
  const section = document.createElement("section"); section.dataset.surveyFlight = "";
  const note = document.createElement("p"); section.append(note);
  const update = () => { note.textContent = context?.() ?? "The flight uses curated Messier and SIMBAD landmarks. DESI tile availability has not been checked."; };
  update(); const timer = setInterval(update, 1000);
  const cleanup = () => { clearInterval(timer); section.remove(); };
  cleanups.set(root, cleanup);
  signal.addEventListener("abort", cleanup, { once: true });
  root.querySelector(".tour-player__content")?.append(section);
  root.querySelectorAll<HTMLElement>("[data-tour-object]").forEach(chip => chip.addEventListener("click", () => {
    trackAnalytics("source_open", { source: "survey_flight", tool: step === 2 ? "last_stop" : "distance" });
  }, { signal }));
  if (step !== 2) return;
  const body = { key: "simbad-3c-273", name: "3C 273", object_type: "active_galaxy", catalog: { ra_deg: 187.27791594049, dec_deg: 2.05238823055 } };
  const media = objectMediaItemsFor(body).find(item => item.provider === "legacy-dr11");
  if (!media) return;
  const figure = document.createElement("figure"); const caption = document.createElement("figcaption");
  const link = document.createElement("a"); link.rel = "noreferrer"; link.target = "_blank";
  const image = document.createElement("img"); image.width = 512; image.height = 320; image.style.cssText = "max-width:100%;height:auto";
  link.append(image); figure.append(link, caption); section.append(figure);
  let current: ObjectMediaItem | ObjectMediaFallback = media;
  const fail = () => {
    if (signal.aborted) return;
    if (current === media && media.fallback) show(media.fallback);
    else { link.remove(); caption.textContent = "Survey image unavailable. The catalog source and distance remain available."; }
  };
  function show(item: ObjectMediaItem | ObjectMediaFallback) {
    current = item; image.alt = item.alt; link.href = item.sourceUrl;
    caption.textContent = `${item.badge} · ${item.credit}. This angular image does not establish distance.`;
    image.src = item.imageUrl;
  }
  image.onerror = fail;
  image.onload = () => {
    if (signal.aborted) return;
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 20;
    const ctx = canvas.getContext("2d");
    try { ctx?.drawImage(image, 0, 0, 32, 20); if (ctx && !pixelBufferHasVisibleVariation(ctx.getImageData(0, 0, 32, 20).data)) fail(); }
    catch { fail(); }
  };
  link.onclick = () => trackAnalytics("source_open", { source: "survey_flight", tool: "cutout", method: current === media ? "dr11" : "allwise" });
  signal.addEventListener("abort", () => { image.onload = null; image.onerror = null; image.removeAttribute("src"); }, { once: true });
  show(media);
}
