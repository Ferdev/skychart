import { formatSpeed, LIGHT_SPEED_AU_S, speedGaugeFraction } from "./universeFormat";

/** Reference speeds marked along the gauge, in AU per second. */
const TICKS: readonly (readonly [string, number])[] = [["AU/s", 1], ["ly/s", 63_241.077], ["Mly/s", 63_241.077e6]];

/** Speedometer for the 3D flight: a logarithmic readout of the current speed
 * with the speed of light marked. It is an indicator, not a control; the
 * thrusters and the autopilot set the speed. */
export class UniverseSpeedGauge {
  constructor(private readonly gauge: HTMLElement, private readonly label: HTMLElement) {
    gauge.style.setProperty("--light-speed", String(speedGaugeFraction(LIGHT_SPEED_AU_S)));
    for (const [unit, speed] of TICKS) {
      const tick = document.createElement("span");
      tick.className = "universe-view__gauge-tick";
      tick.textContent = unit;
      tick.style.setProperty("--at", String(speedGaugeFraction(speed)));
      gauge.append(tick);
    }
    this.show(0);
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
