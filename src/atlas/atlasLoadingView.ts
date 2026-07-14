import type { LoadingStep } from "./contracts";

interface AtlasLoadingViewOptions {
  detail: HTMLElement;
  fill: HTMLElement;
  progressLabel: HTMLElement;
  stepLabel: HTMLElement;
  elapsed: HTMLElement;
  errorPanel: HTMLElement;
}

export class AtlasLoadingView {
  private startedAt = performance.now();

  constructor(private readonly options: AtlasLoadingViewOptions) {}

  begin(): void {
    this.startedAt = performance.now();
  }

  update(step: LoadingStep, progress: number, detail: string): void {
    this.options.detail.textContent = detail;
    this.options.fill.style.width = `${progress}%`;
    this.options.progressLabel.textContent = `${progress}%`;
    this.options.stepLabel.textContent = step;
    this.options.elapsed.textContent = `${((performance.now() - this.startedAt) / 1000).toFixed(1)}s`;
    for (const item of document.querySelectorAll<HTMLElement>("[data-loading-step]")) {
      item.classList.toggle("active", item.dataset.loadingStep === step);
    }
  }

  setError(message: string): void {
    this.options.errorPanel.hidden = !message;
    this.options.errorPanel.textContent = message;
  }
}
