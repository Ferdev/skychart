import { hasBodyPosition } from "../catalog/spacecraftCatalog";
import { escapeHtml, formatNumber, formatRatio } from "../atlasFormatting";
import type { Body } from "../atlas/contracts";
import { classifyBody } from "../destinationPicker";
import { t } from "../i18n";
import { educationalComparisons } from "../navigationMetrics";

type SizeVisual = {
  diameterPx: number;
  isSubpixel: boolean;
  visualType: string;
};

type ObjectComparisonViewOptions = {
  heading: HTMLElement;
  panel: HTMLElement;
  /** The actions that need an object B (copy link, clear). They are hidden until object B exists. */
  actions: HTMLElement;
  auKm: () => number;
  distanceKm: (left: Body, right: Body) => number;
  formatDistance: (kilometers: number) => string;
};

const MAX_DIAMETER_PX = 112;

/** Renders the selected pair, physical distance comparisons, and true diameter scale. */
export class ObjectComparisonView {
  constructor(private readonly options: ObjectComparisonViewOptions) {}

  update(selected: Body | null, target: Body | null) {
    this.options.actions.hidden = !selected || !target;
    if (!selected) {
      this.options.heading.textContent = t("compare.heading");
      this.options.panel.innerHTML = "";
      return;
    }

    this.options.heading.textContent = t("compare.compareObject", { name: selected.name });
    if (!hasBodyPosition(selected) || (target && !hasBodyPosition(target))) {
      this.options.panel.textContent = t("sky.positionUnavailable");
      return;
    }
    if (!target) {
      this.options.panel.innerHTML = `
        <section class="compare-card compare-card--empty">
          <div class="compare-pair">
            ${this.renderObject(selected, "A")}
            <article class="compare-object compare-object--empty">
              <span>B</span>
              <div>
                <strong>${escapeHtml(t("compare.chooseObjectB"))}</strong>
                <small>${escapeHtml(t("compare.searchToCompare"))}</small>
              </div>
            </article>
          </div>
        </section>
      `;
      return;
    }

    const distanceKm = this.options.distanceKm(selected, target);
    const comparisons = educationalComparisons(distanceKm, { auKm: this.options.auKm(), includeMissionComparisons: false }).slice(0, 4);
    const sizeComparison = this.sizeModel(selected, target);
    // The distance shows one time. The value in AU is an extra only when the main unit is not AU.
    const distanceLabel = this.options.formatDistance(distanceKm);
    const auLabel = `${formatNumber(distanceKm / this.options.auKm())} AU`;
    this.options.panel.innerHTML = `
      <section class="compare-card">
        <div class="compare-distance compare-distance--hero">
          <span>${escapeHtml(t("compare.currentDistance"))}</span>
          <strong>${escapeHtml(distanceLabel)}</strong>
          ${auLabel === distanceLabel ? "" : `<small>${escapeHtml(auLabel)}</small>`}
        </div>
        <div class="compare-pair">
          ${this.renderObject(selected, "A")}
          ${this.renderObject(target, "B")}
        </div>
        <dl class="comparison-list">
          ${comparisons.map((comparison) => `<dt>${escapeHtml(t(comparison.labelKey))}</dt><dd>${escapeHtml(comparison.displayValue)}</dd>`).join("")}
        </dl>
        <a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.distanceMethodology"))}</a>
      </section>
      <section class="size-compare-card">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">${escapeHtml(t("compare.trueDiameterRatio"))}</p>
            <h3>${escapeHtml(sizeComparison.ratioLabel)}</h3>
            ${sizeComparison.scaleLabel ? `<small>${escapeHtml(sizeComparison.scaleLabel)}</small>` : ""}
          </div>
        </div>
        <div class="size-stage">
          ${this.renderSizeDisk(selected, sizeComparison.a)}
          ${this.renderSizeDisk(target, sizeComparison.b)}
        </div>
      </section>
    `;
  }

  private renderObject(body: Body, label: string) {
    const classification = classifyBody(body);
    // A card shows only what the catalog has. The inspector tells the user when a value or its uncertainty is unknown.
    const details = [classification.label, body.radius_km > 0 ? `${this.options.formatDistance(body.radius_km)} ${t("picker.radius")}` : null]
      .filter((detail): detail is string => Boolean(detail));
    return `
      <article class="compare-object" style="--body-color: ${escapeHtml(body.color)}">
        <span>${label}</span>
        <div>
          <strong>${escapeHtml(body.name)}</strong>
          <small>${escapeHtml(details.join(" · "))}</small>
        </div>
      </article>
    `;
  }

  private renderSizeDisk(body: Body, visual: SizeVisual) {
    const diskMarkup = visual.isSubpixel
      ? `<span class="size-visual size-visual--subpixel" aria-hidden="true"></span>`
      : `<span class="size-visual size-visual--${escapeHtml(visual.visualType)}" aria-hidden="true"></span>`;
    return `
      <figure class="size-disk-wrap ${visual.isSubpixel ? "is-subpixel" : ""}" data-object-type="${escapeHtml(visual.visualType)}" style="--disk-size: ${visual.diameterPx.toFixed(2)}px; --body-color: ${escapeHtml(body.color)}">
        <div class="size-disk-slot">${diskMarkup}</div>
        <figcaption>
          <strong>${escapeHtml(body.name)}</strong>
          ${body.radius_km > 0 ? `<span>${escapeHtml(this.options.formatDistance(body.radius_km * 2))} ${escapeHtml(t("field.diameter"))}</span>` : ""}
          ${visual.isSubpixel ? `<span class="size-subpixel-note">${escapeHtml(t("compare.subpixel"))}</span>` : ""}
        </figcaption>
      </figure>
    `;
  }

  private sizeModel(left: Body, right: Body) {
    const diameterA = Math.max(0, left.radius_km * 2);
    const diameterB = Math.max(0, right.radius_km * 2);
    const maxDiameter = Math.max(diameterA, diameterB, 1);
    const visual = (body: Body, diameterKm: number): SizeVisual => {
      const diameterPx = (diameterKm / maxDiameter) * MAX_DIAMETER_PX;
      return { diameterPx, isSubpixel: diameterKm > 0 && diameterPx < 1, visualType: classifyBody(body).type };
    };
    const ratio = diameterB / Math.max(diameterA, 1);
    const unknown = diameterA <= 0 ? left : diameterB <= 0 ? right : null;
    const ratioLabel = unknown
      ? t("compare.sizeUnknown", { name: unknown.name })
      : ratio >= 1
        ? t("compare.sizeRatio", { name: right.name, ratio: formatRatio(ratio), other: left.name })
        : t("compare.sizeRatio", { name: left.name, ratio: formatRatio(1 / Math.max(ratio, 1e-9)), other: right.name });
    return {
      a: visual(left, diameterA),
      b: visual(right, diameterB),
      ratioLabel,
      scaleLabel: unknown ? "" : t("compare.sizeScale", { distance: this.options.formatDistance(maxDiameter / MAX_DIAMETER_PX) }),
    };
  }
}
