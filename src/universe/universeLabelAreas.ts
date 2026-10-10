import type { LabelRect } from "../labels/labelRank";
import { universeLabelLimit } from "./universeLabelLimit";

export type UniverseLabelArea = {
  /** A label must be fully inside this rectangle. */
  bounds: LabelRect;
  /** The rectangles of the header, the trip map, the flight panel, the target card, and the touch controls. */
  exclusions: readonly LabelRect[];
  limit: number;
};


/**
 * The areas of the 3D view that labels must not use.
 * The rectangles are read again only after a resize or a layout change of a control, not for each frame.
 */
export class UniverseLabelAreas {
  private area: UniverseLabelArea | null = null;
  private readonly observer: ResizeObserver;

  constructor(private readonly root: HTMLElement, private readonly controls: readonly HTMLElement[]) {
    this.observer = new ResizeObserver(() => this.invalidate());
    this.observer.observe(root);
    for (const control of controls) this.observer.observe(control);
  }

  /** Call when a control shows, hides, or moves with no change of its size. */
  invalidate(): void {
    this.area = null;
  }

  get(): UniverseLabelArea {
    this.area ??= this.read();
    return this.area;
  }

  private read(): UniverseLabelArea {
    const root = this.root.getBoundingClientRect();
    const exclusions: LabelRect[] = [];
    for (const control of this.controls) {
      const rect = control.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      exclusions.push({ left: rect.left - root.left - 4, top: rect.top - root.top - 4, right: rect.right - root.left + 4, bottom: rect.bottom - root.top + 4 });
    }
    return {
      bounds: { left: 8, top: 8, right: root.width - 8, bottom: root.height - 8 },
      exclusions,
      limit: universeLabelLimit(root.width),
    };
  }
}
