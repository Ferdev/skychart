/** Floats for one point of the "rich" WebGL body layer: x, y, red, green, blue, radius. */
export const RICH_POINT_STRIDE_FLOATS = 6;

// Float32 keeps 24 bits. A point this many view widths from the origin still
// lands within 0.02 pixel on a 1,000-pixel view.
const ORIGIN_MAX_DRIFT_VIEW_WIDTHS = 256;

export type RichPoint = {
  xAu: number;
  yAu: number;
  red: number;
  green: number;
  blue: number;
  radiusAu: number;
};

export type PointLayerOrigin = { x: number; y: number };

/**
 * Packs body points relative to an origin near the camera.
 *
 * The subtraction uses 64-bit numbers before the Float32 conversion. Absolute
 * AU values in Float32 have a step of 0.25 AU at 2.5 million AU, which puts
 * each planet of a distant system on its star.
 */
export function packRichPoints(points: readonly RichPoint[], origin: PointLayerOrigin): Float32Array {
  const vertices = new Float32Array(points.length * RICH_POINT_STRIDE_FLOATS);
  points.forEach((point, index) => {
    const offset = index * RICH_POINT_STRIDE_FLOATS;
    vertices[offset] = point.xAu - origin.x;
    vertices[offset + 1] = point.yAu - origin.y;
    vertices[offset + 2] = point.red;
    vertices[offset + 3] = point.green;
    vertices[offset + 4] = point.blue;
    vertices[offset + 5] = point.radiusAu;
  });
  return vertices;
}

/** Keeps the layer origin while the camera stays near it, so that a pan does not upload the layer again. */
export function richLayerOrigin(
  previous: PointLayerOrigin | null,
  camera: { xAu: number; yAu: number },
  viewWidthAu: number,
): PointLayerOrigin {
  if (previous && Math.hypot(camera.xAu - previous.x, camera.yAu - previous.y) <= ORIGIN_MAX_DRIFT_VIEW_WIDTHS * viewWidthAu) {
    return previous;
  }
  return { x: camera.xAu, y: camera.yAu };
}
