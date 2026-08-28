import { clamp } from "../geometry";

export type SkyConnectorSource = { key: string; x: number; y: number };

type SkySelectionConnectorViewOptions = {
  element: SVGSVGElement;
  canvas: HTMLCanvasElement;
  workspacePanel: HTMLElement;
};

type ConnectorAnchor = { x: number; y: number; edge: "horizontal" | "vertical" };

/** Visually attaches a projected sky point to the object inspector raised above the sky. */
export class SkySelectionConnectorView {
  private readonly leader: SVGPathElement;
  private readonly source: SVGCircleElement;
  private readonly anchor: SVGCircleElement;

  constructor(private readonly options: SkySelectionConnectorViewOptions) {
    this.leader = requiredSvgElement(options.element, ".sky-selection-connector__leader", SVGPathElement);
    this.source = requiredSvgElement(options.element, ".sky-selection-connector__source", SVGCircleElement);
    this.anchor = requiredSvgElement(options.element, ".sky-selection-connector__anchor", SVGCircleElement);
  }

  update(source: SkyConnectorSource | null): void {
    const panel = this.options.workspacePanel.getBoundingClientRect();
    const canvas = this.options.canvas.getBoundingClientRect();
    if (!source || this.options.workspacePanel.hidden || panel.width <= 0 || panel.height <= 0) {
      this.hide();
      return;
    }

    const point = { x: canvas.left + source.x, y: canvas.top + source.y };
    if (point.x < canvas.left || point.x > canvas.right || point.y < canvas.top || point.y > canvas.bottom) {
      this.hide();
      return;
    }

    const target = nearestPanelAnchor(point, panel);
    const midpoint = target.edge === "horizontal"
      ? { x: (point.x + target.x) / 2, y: 0 }
      : { x: 0, y: (point.y + target.y) / 2 };
    const controls = target.edge === "horizontal"
      ? `${midpoint.x.toFixed(1)} ${point.y.toFixed(1)} ${midpoint.x.toFixed(1)} ${target.y.toFixed(1)}`
      : `${point.x.toFixed(1)} ${midpoint.y.toFixed(1)} ${target.x.toFixed(1)} ${midpoint.y.toFixed(1)}`;

    this.options.element.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
    this.options.element.dataset.sourceKey = source.key;
    this.leader.setAttribute("d", `M ${point.x.toFixed(1)} ${point.y.toFixed(1)} C ${controls} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`);
    this.source.setAttribute("cx", point.x.toFixed(1));
    this.source.setAttribute("cy", point.y.toFixed(1));
    this.anchor.setAttribute("cx", target.x.toFixed(1));
    this.anchor.setAttribute("cy", target.y.toFixed(1));
    this.options.element.removeAttribute("hidden");
  }

  hide(): void {
    this.options.element.setAttribute("hidden", "");
    delete this.options.element.dataset.sourceKey;
  }
}

function nearestPanelAnchor(point: { x: number; y: number }, panel: DOMRect): ConnectorAnchor {
  const inset = Math.min(48, Math.max(18, Math.min(panel.width, panel.height) * 0.1));
  const candidates: ConnectorAnchor[] = [
    { x: panel.left, y: clamp(point.y, panel.top + inset, panel.bottom - inset), edge: "horizontal" },
    { x: panel.right, y: clamp(point.y, panel.top + inset, panel.bottom - inset), edge: "horizontal" },
    { x: clamp(point.x, panel.left + inset, panel.right - inset), y: panel.top, edge: "vertical" },
    { x: clamp(point.x, panel.left + inset, panel.right - inset), y: panel.bottom, edge: "vertical" },
  ];
  return candidates.reduce((nearest, candidate) =>
    squaredDistance(point, candidate) < squaredDistance(point, nearest) ? candidate : nearest);
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function requiredSvgElement<T extends SVGElement>(root: SVGSVGElement, selector: string, constructor: { new(): T }): T {
  const element = root.querySelector<T>(selector);
  if (!element || !(element instanceof constructor)) throw new Error(`Missing required SVG element: ${selector}`);
  return element;
}
