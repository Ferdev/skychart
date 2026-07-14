import { clamp } from "../geometry";
import type { Ephemeris } from "./contracts";

interface TimeStep {
  days: number;
  labelKey: string;
}

interface AtlasTimeControllerOptions {
  timeSummary: HTMLElement;
  timeInput: HTMLInputElement;
  timeStepLabel: HTMLElement;
  timeStepSlider: HTMLInputElement;
  steps: readonly TimeStep[];
  ephemeris: () => Ephemeris | null;
  formatDate: (timestamp: string) => string;
  toLocalInput: (date: Date) => string;
  translate: (key: string) => string;
  loadAtlas: (timestamp: string) => void;
}

export class AtlasTimeController {
  constructor(private readonly options: AtlasTimeControllerOptions) {}

  updateSummary(): void {
    const ephemeris = this.options.ephemeris();
    if (ephemeris) this.options.timeSummary.textContent = this.options.formatDate(ephemeris.timestamp_utc);
  }

  updateStep(): void {
    this.options.timeStepLabel.textContent = this.options.translate(this.currentStep().labelKey);
  }

  step(direction: -1 | 1): void {
    const current = this.dateFromInput() ?? new Date(this.options.ephemeris()?.timestamp_utc ?? Date.now());
    const next = new Date(current.getTime() + direction * this.currentStep().days * 86_400_000);
    this.options.timeInput.value = this.options.toLocalInput(next);
    this.options.loadAtlas(next.toISOString());
  }

  dateFromInput(): Date | null {
    if (!this.options.timeInput.value) return null;
    const date = new Date(`${this.options.timeInput.value}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private currentStep(): TimeStep {
    const index = clamp(Math.round(Number(this.options.timeStepSlider.value)), 0, this.options.steps.length - 1);
    return this.options.steps[index] ?? this.options.steps[2];
  }
}
