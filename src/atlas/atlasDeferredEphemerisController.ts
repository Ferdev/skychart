import { loadDeferredAtlasEphemeris } from "./atlasEphemerisLoader";
import type { Body } from "./contracts";
import type { ViewState } from "../viewState";

interface AtlasDeferredEphemerisControllerOptions {
  serverBootObjectKey?: string;
  hasBody: (key: string) => boolean;
  applyBodies: (bodies: Body[]) => void;
  restoreSelection: (state: ViewState) => Promise<void>;
  selectServerBoot: (key: string) => Promise<void>;
}

/** Hydrates network-backed moon positions after the usable atlas is visible. */
export class AtlasDeferredEphemerisController {
  private generation = 0;
  private abort: AbortController | null = null;

  constructor(private readonly options: AtlasDeferredEphemerisControllerOptions) {}

  cancel(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
  }

  load(timestampIso: string, selectionState: ViewState | null): void {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.abort = controller;
    void this.run(timestampIso, selectionState, generation, controller);
  }

  private async run(
    timestampIso: string,
    selectionState: ViewState | null,
    generation: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      const bodies = await loadDeferredAtlasEphemeris(timestampIso, controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return;
      const deferredKeys = new Set(bodies.map((body) => body.key));
      const requestedKeys = [
        selectionState?.compare?.[0] ?? selectionState?.objectKey,
        selectionState?.compare?.[1],
        selectionState?.sky?.observerKey,
      ].filter((key): key is string => Boolean(key));
      const retrySelection = requestedKeys.some((key) => deferredKeys.has(key) && !this.options.hasBody(key));
      const bootKey = this.options.serverBootObjectKey;
      const retryServerBoot = Boolean(bootKey && deferredKeys.has(bootKey) && !this.options.hasBody(bootKey));
      this.options.applyBodies(bodies);
      if (retrySelection && selectionState) await this.options.restoreSelection(selectionState);
      else if (retryServerBoot && bootKey) await this.options.selectServerBoot(bootKey);
    } catch (error) {
      if (!controller.signal.aborted) console.warn("Deferred moon ephemeris unavailable.", error);
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }
}
