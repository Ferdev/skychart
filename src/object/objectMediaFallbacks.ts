import { t } from "../i18n";
import { pixelBufferHasVisibleVariation } from "../objectMedia";

/** Checks the images of the inspector media section and changes to the fallback image when a survey image has no data. */
export class ObjectMediaFallbacks {
  private cleanups: (() => void)[] = [];

  install(root: HTMLElement) {
    const syncSectionState = (mediaSection: HTMLElement | null) => {
      if (!mediaSection) return;
      const cards = [...mediaSection.querySelectorAll<HTMLElement>(".object-media")];
      const mediaList = mediaSection.querySelector<HTMLElement>(".object-media-list");
      if (mediaList) mediaList.hidden = cards.every((candidate) => candidate.hidden);

      const status = mediaSection.querySelector<HTMLElement>("[data-media-status]");
      if (!status) return;
      const surveys = cards.filter((candidate) => candidate.dataset.mediaValidation === "pixels");
      const loading = surveys.filter((candidate) => candidate.dataset.mediaState === "loading");
      const available = surveys.filter((candidate) => candidate.dataset.mediaState === "available");
      const failed = surveys.filter((candidate) => candidate.dataset.mediaState === "failed");

      if (loading.length > 0) {
        this.updateMediaStatus(status, "loading", t("object.mediaLoading"), t("object.mediaLoadingBody"));
      } else if (available.length > 0) {
        status.hidden = true;
      } else if (failed.length > 0) {
        this.updateMediaStatus(status, "failed", t("object.mediaFailed"), t("object.mediaFailedBody"));
      } else {
        this.updateMediaStatus(status, "unavailable", t("object.mediaUnavailable"), t("object.mediaUnavailableBody"));
      }
    };
    for (const mediaSection of root.querySelectorAll<HTMLElement>(".object-media-section")) {
      syncSectionState(mediaSection);
    }

    for (const card of root.querySelectorAll<HTMLElement>(".object-media")) {
      const image = card.querySelector<HTMLImageElement>("img");
      if (!image) continue;

      const fallbackSrc = card.dataset.fallbackSrc;
      const mediaSection = card.closest<HTMLElement>(".object-media-section");
      const requiresPixelValidation = card.dataset.mediaValidation === "pixels";
      let settled = false;
      let usingFallback = false;
      let fallbackFailureState: "unavailable" | "failed" = "unavailable";
      let timeoutId: number | null = null;
      const clearPending = () => {
        if (timeoutId != null) window.clearTimeout(timeoutId);
        timeoutId = null;
      };
      this.cleanups.push(() => {
        settled = true;
        clearPending();
      });
      const finish = (state: "available" | "unavailable" | "failed") => {
        if (settled) return;
        settled = true;
        clearPending();
        card.dataset.mediaState = state;
        card.hidden = state !== "available";
        syncSectionState(mediaSection);
      };

      if (!requiresPixelValidation) {
        image.addEventListener("error", () => finish("failed"), { once: true });
        if (image.complete && image.naturalWidth <= 0) finish("failed");
        continue;
      }

      const startTimeout = (onTimeout: () => void) => {
        if (timeoutId == null && !settled) timeoutId = window.setTimeout(onTimeout, 30_000);
      };
      let validateLoadedImage = () => {};
      const useFallback = (reason: "unavailable" | "failed") => {
        if (settled || usingFallback || !fallbackSrc) {
          if (!fallbackSrc) finish(reason);
          return;
        }
        usingFallback = true;
        fallbackFailureState = reason;
        clearPending();
        card.dataset.mediaProvider = card.dataset.fallbackProvider ?? "fallback";
        card.dataset.mediaState = "loading";
        card.classList.add("object-media--fallback");
        image.addEventListener("load", validateLoadedImage, { once: true });
        image.addEventListener("error", () => finish("failed"), { once: true });
        image.src = fallbackSrc;
        image.alt = card.dataset.fallbackAlt ?? image.alt;
        const updates: [string, string | undefined][] = [
          [".object-media__badge", card.dataset.fallbackBadge],
          [".object-media__title", card.dataset.fallbackTitle],
          [".object-media__description", card.dataset.fallbackDescription],
          [".object-media__credit", card.dataset.fallbackCredit]
        ];
        for (const [selector, value] of updates) {
          const element = card.querySelector<HTMLElement>(selector);
          if (element && value) element.textContent = value;
        }
        const source = card.querySelector<HTMLAnchorElement>(".object-media__source");
        if (source) {
          if (card.dataset.fallbackSourceUrl) source.href = card.dataset.fallbackSourceUrl;
          if (card.dataset.fallbackLicense) source.textContent = card.dataset.fallbackLicense;
        }
        syncSectionState(mediaSection);
        startTimeout(() => finish("failed"));
      };
      validateLoadedImage = () => {
        if (settled) return;
        if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
          if (usingFallback) finish("failed");
          else useFallback("failed");
          return;
        }
        if (!this.mediaImageHasVisibleData(image)) {
          if (usingFallback) finish(fallbackFailureState);
          else useFallback("unavailable");
          return;
        }
        finish("available");
      };

      image.addEventListener("load", validateLoadedImage, { once: true });
      image.addEventListener("error", () => useFallback("failed"), { once: true });
      if (image.complete) {
        if (image.naturalWidth > 0) validateLoadedImage();
        else useFallback("failed");
      } else {
        startTimeout(() => useFallback("failed"));
      }
    }
  }

  private updateMediaStatus(status: HTMLElement, state: "loading" | "unavailable" | "failed", title: string, body: string) {
    status.hidden = false;
    status.dataset.mediaStatus = state;
    status.className = `object-media-status object-media-status--${state}`;
    const titleElement = status.querySelector<HTMLElement>("[data-media-status-title]");
    const bodyElement = status.querySelector<HTMLElement>("[data-media-status-body]");
    if (titleElement) titleElement.textContent = title;
    if (bodyElement) bodyElement.textContent = body;
  }

  private mediaImageHasVisibleData(image: HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return true;
    try {
      context.drawImage(image, 0, 0);
      return pixelBufferHasVisibleVariation(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      // Keep a successfully loaded image if canvas access is unexpectedly
      // unavailable; transport policy is not evidence that survey data is blank.
      return true;
    }
  }

  clear() {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
}
