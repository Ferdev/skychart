import type { Body } from "../atlas/contracts";
import { expandedRect, pointInRect, type Rect, type ScreenPoint } from "../geometry";

type SelectionConnectorViewOptions = {
  element: SVGSVGElement;
  workspacePanel: HTMLElement;
  bodyInfo: HTMLElement;
  selectedBody: () => Body | null;
  active: () => boolean;
  viewport: () => Rect;
  bodyToScreen: (body: Body) => ScreenPoint;
};

/**
 * Puts a ring on the selected map point while its inspector is open.
 * No line goes from the object to the panel: the ring and the panel header name the same object.
 */
export class SelectionConnectorView {
  private readonly source: SVGCircleElement;

  constructor(private readonly options: SelectionConnectorViewOptions) {
    this.source = requiredSvgElement(options.element, ".selection-connector__source", SVGCircleElement);
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

    this.options.element.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
    this.source.setAttribute("cx", point.x.toFixed(1));
    this.source.setAttribute("cy", point.y.toFixed(1));
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
