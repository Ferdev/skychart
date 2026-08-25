import type { Body } from "../atlas/contracts";
import { clamp, expandedRect, pointInRect, type Rect, type ScreenPoint } from "../geometry";

type SelectionConnectorViewOptions = {
  element: SVGSVGElement;
  workspacePanel: HTMLElement;
  bodyInfo: HTMLElement;
  selectedBody: () => Body | null;
  active: () => boolean;
  viewport: () => Rect;
  bodyToScreen: (body: Body) => ScreenPoint;
};

/** Keeps the selected map point spatially attached to the progressive inspector. */
export class SelectionConnectorView {
  private readonly leader: SVGPathElement;
  private readonly source: SVGCircleElement;
  private readonly anchor: SVGCircleElement;

  constructor(private readonly options: SelectionConnectorViewOptions) {
    this.leader = requiredSvgElement(options.element, ".selection-connector__leader", SVGPathElement);
    this.source = requiredSvgElement(options.element, ".selection-connector__source", SVGCircleElement);
    this.anchor = requiredSvgElement(options.element, ".selection-connector__anchor", SVGCircleElement);
  }

  update(): void {
    const body = this.options.selectedBody();
    if (
      !body
      || !this.options.active()
      || window.innerWidth < 900
      || this.options.workspacePanel.hidden
      || this.options.bodyInfo.hidden
    ) {
      this.hide();
      return;
    }

    const viewport = this.options.viewport();
    const point = this.options.bodyToScreen(body);
    const panel = this.options.workspacePanel.getBoundingClientRect();
    if (
      panel.width <= 0
      || panel.height <= 0
      || point.x >= panel.left - 4
      || !pointInRect(point, expandedRect(viewport, 24))
    ) {
      this.hide();
      return;
    }

    const tabs = this.options.bodyInfo.querySelector<HTMLElement>(".object-view-tabs")?.getBoundingClientRect();
    const anchorY = clamp(tabs?.top ?? panel.top + 190, panel.top + 104, panel.bottom - 72);
    const sourceX = Math.min(point.x + 12, panel.left - 8);
    const elbowX = Math.max(sourceX + 24, panel.left - 82);
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.options.element.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.leader.setAttribute("d", `M ${sourceX.toFixed(1)} ${point.y.toFixed(1)} L ${elbowX.toFixed(1)} ${point.y.toFixed(1)} L ${panel.left.toFixed(1)} ${anchorY.toFixed(1)}`);
    this.source.setAttribute("cx", point.x.toFixed(1));
    this.source.setAttribute("cy", point.y.toFixed(1));
    this.anchor.setAttribute("cx", panel.left.toFixed(1));
    this.anchor.setAttribute("cy", anchorY.toFixed(1));
    this.options.element.removeAttribute("hidden");
    this.options.element.dataset.visible = "true";
  }

  private hide(): void {
    this.options.element.setAttribute("hidden", "");
    delete this.options.element.dataset.visible;
  }
}

function requiredSvgElement<T extends SVGElement>(root: SVGSVGElement, selector: string, constructor: { new(): T }): T {
  const element = root.querySelector<T>(selector);
  if (!element || !(element instanceof constructor)) throw new Error(`Missing required SVG element: ${selector}`);
  return element;
}
