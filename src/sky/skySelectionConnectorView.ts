export type SkyConnectorSource = { key: string; x: number; y: number };

type SkySelectionConnectorViewOptions = {
  element: SVGSVGElement;
  canvas: HTMLCanvasElement;
  workspacePanel: HTMLElement;
};

/** Puts a ring on the selected point of Sky view or 3D mode while its inspector is open. No line goes to the panel. */
export class SkySelectionConnectorView {
  private readonly source: SVGCircleElement;

  constructor(private readonly options: SkySelectionConnectorViewOptions) {
    this.source = requiredSvgElement(options.element, ".sky-selection-connector__source", SVGCircleElement);
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

    this.options.element.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
    this.options.element.dataset.sourceKey = source.key;
    this.source.setAttribute("cx", point.x.toFixed(1));
    this.source.setAttribute("cy", point.y.toFixed(1));
    this.options.element.removeAttribute("hidden");
  }

  hide(): void {
    this.options.element.setAttribute("hidden", "");
    delete this.options.element.dataset.sourceKey;
  }
}

function requiredSvgElement<T extends SVGElement>(root: SVGSVGElement, selector: string, constructor: { new(): T }): T {
  const element = root.querySelector<T>(selector);
  if (!element || !(element instanceof constructor)) throw new Error(`Missing required SVG element: ${selector}`);
  return element;
}
