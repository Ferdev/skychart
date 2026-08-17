import { escapeHtml, formatNumber, formatRatio } from "../atlasFormatting";
import type { Body } from "../atlas/contracts";
import { classifyBody } from "../destinationPicker";
import { t } from "../i18n";
import { educationalComparisons } from "../navigationMetrics";
import { uncertaintySummary } from "../scienceSemantics";

type SizeVisual = {
  diameterPx: number;
  isSubpixel: boolean;
  visualType: string;
};

type ObjectComparisonViewOptions = {
  heading: HTMLElement;
  panel: HTMLElement;
  auKm: () => number;
  distanceKm: (left: Body, right: Body) => number;
  formatDistance: (kilometers: number) => string;
  afterRender: () => void;
};

const MAX_DIAMETER_PX = 112;

/** Renders the selected pair, physical distance comparisons, and true diameter scale. */
export class ObjectComparisonView {
  constructor(private readonly options: ObjectComparisonViewOptions) {}

  update(selected: Body | null, target: Body | null) {
    if (!selected) {
      this.options.heading.textContent = t("compare.heading");
      this.options.panel.innerHTML = "";
      this.options.afterRender();
      return;
    }

    this.options.heading.textContent = t("compare.compareObject", { name: selected.name });
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
      this.options.afterRender();
      return;
    }

    const distanceKm = this.options.distanceKm(selected, target);
    const comparisons = educationalComparisons(distanceKm, { auKm: this.options.auKm(), includeMissionComparisons: false }).slice(0, 4);
    const sizeComparison = this.sizeModel(selected, target);
    this.options.panel.innerHTML = `
      <section class="compare-card">
        <div class="compare-distance compare-distance--hero">
          <span>${escapeHtml(t("compare.currentDistance"))}</span>
          <strong>${escapeHtml(this.options.formatDistance(distanceKm))}</strong>
          <small>${escapeHtml(formatNumber(distanceKm / this.options.auKm()))} AU</small>
        </div>
        <div class="compare-pair">
          ${this.renderObject(selected, "A")}
          ${this.renderObject(target, "B")}
        </div>
        <dl class="comparison-list">
          ${comparisons.map((comparison) => `<dt>${escapeHtml(comparison.label)}</dt><dd>${escapeHtml(comparison.displayValue)}</dd>`).join("")}
        </dl>
        <a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.distanceMethodology"))}</a>
      </section>
      <section class="size-compare-card">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">${escapeHtml(t("compare.trueDiameterRatio"))}</p>
            <h3>${escapeHtml(sizeComparison.ratioLabel)}</h3>
            <small>${escapeHtml(sizeComparison.scaleLabel)}</small>
          </div>
        </div>
        <div class="size-stage">
          ${this.renderSizeDisk(selected, sizeComparison.a)}
          ${this.renderSizeDisk(target, sizeComparison.b)}
        </div>
      </section>
    `;
    this.options.afterRender();
  }

  private renderObject(body: Body, label: string) {
    const classification = classifyBody(body);
    const radiusLabel = body.radius_km > 0 ? `${this.options.formatDistance(body.radius_km)} ${t("picker.radius")}` : t("compare.radiusUnknown");
    return `
      <article class="compare-object" style="--body-color: ${escapeHtml(body.color)}">
        <span>${label}</span>
        <div>
          <strong>${escapeHtml(body.name)}</strong>
          <small>${escapeHtml(classification.label)} · ${escapeHtml(radiusLabel)}</small>
          <small>${escapeHtml(uncertaintySummary({ position_model: body.catalog?.position_model, facts: body.catalog?.facts }))}</small>
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
          <span>${escapeHtml(this.options.formatDistance(body.radius_km * 2))} ${escapeHtml(t("field.diameter"))}</span>
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
    const ratioLabel = ratio >= 1
      ? `${right.name} is ${formatRatio(ratio)}x ${left.name}`
      : `${left.name} is ${formatRatio(1 / Math.max(ratio, 1e-9))}x ${right.name}`;
    return {
      a: visual(left, diameterA),
      b: visual(right, diameterB),
      ratioLabel,
      scaleLabel: `Scale: ${this.options.formatDistance(maxDiameter / MAX_DIAMETER_PX)} per screen pixel`,
    };
  }
}
