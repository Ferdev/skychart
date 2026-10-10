const LABEL_LIMIT = 30;
const NARROW_LABEL_LIMIT = 12;
const NARROW_WIDTH_PX = 640;

/** The largest number of labels in the 3D view: 30, or 12 on a narrow screen. */
export function universeLabelLimit(viewWidth: number): number {
  return viewWidth <= NARROW_WIDTH_PX ? NARROW_LABEL_LIMIT : LABEL_LIMIT;
}
