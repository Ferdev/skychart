import { formatSpeed, LIGHT_SPEED_AU_S, speedGaugeFraction } from "./universeFormat";

/** Reference speeds marked along the gauge, in AU per second, with the key of the text that explains the mark. */
const TICKS: readonly (readonly [string, number, string])[] = [
  ["AU/s", 1, "universe3d.tick.auPerSecond"],
  ["ly/s", 63_241.077, "universe3d.tick.lyPerSecond"],
  ["Mly/s", 63_241.077e6, "universe3d.tick.mlyPerSecond"],
];

/** Speedometer for the 3D flight: a logarithmic readout of the current speed
 * with the speed of light marked. It is an indicator, not a control; the
 * thrusters and the autopilot set the speed. */
export class UniverseSpeedGauge {
  private readonly ticks: { element: HTMLElement; titleKey: string }[] = [];

  constructor(private readonly gauge: HTMLElement, private readonly label: HTMLElement) {
    gauge.style.setProperty("--light-speed", String(speedGaugeFraction(LIGHT_SPEED_AU_S)));
    for (const [unit, speed, titleKey] of TICKS) {
      const tick = document.createElement("span");
      tick.className = "universe-view__gauge-tick";
      tick.textContent = unit;
      tick.style.setProperty("--at", String(speedGaugeFraction(speed)));
      gauge.append(tick);
      this.ticks.push({ element: tick, titleKey });
    }
    this.show(0);
  }

  /** Sets the text that explains each mark, in the active language. */
  localize(translate: (key: string) => string): void {
    for (const tick of this.ticks) tick.element.title = translate(tick.titleKey);
  }

  show(speedAuPerSecond: number): void {
    const text = formatSpeed(speedAuPerSecond);
    if (text === this.label.textContent) return;
    const fraction = speedGaugeFraction(speedAuPerSecond);
    this.label.textContent = text;
    this.gauge.style.setProperty("--speed", fraction.toFixed(4));
    this.gauge.setAttribute("aria-valuenow", fraction.toFixed(3));
    this.gauge.setAttribute("aria-valuetext", text);
    this.gauge.dataset.fasterThanLight = String(speedAuPerSecond > LIGHT_SPEED_AU_S);
  }
}
