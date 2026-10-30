import { directionFromEquatorial } from "../coordinates";
import { canvasFont } from "../format/fonts";
import type { Vector3 } from "../sky/skyProjection";
import { targetMarkers, type TargetMatchRow } from "./targetList";

type Marker = ReturnType<typeof targetMarkers>[number];
type Point = { x: number; y: number };

/** The gold of the interface (`--accent-strong`), for the rings on a canvas. */
const COLOR = "#efc468";
const RADIUS_PX = 7;
/** With more objects in view, a name on each ring hides the map. */
const LABEL_LIMIT = 30;

/** The temporary layer of a matched list. It is in memory only, and it is not part of a shared view. */
class TargetListLayer {
  private markers: Marker[] = [];
  /** Asks the views for a new frame. */
  changed: (() => void) | null = null;

  set(rows: readonly TargetMatchRow[]) {
    this.markers = targetMarkers(rows);
    this.changed?.();
  }

  clear() {
    this.set([]);
  }

  /** The 2D map has a place only for an object with a physical position. */
  drawMap(context: CanvasRenderingContext2D, toScreen: (xAu: number, yAu: number) => Point) {
    const places = this.markers.flatMap((marker) => (marker.xAu === null || marker.yAu === null ? [] : [{ marker, point: toScreen(marker.xAu, marker.yAu) }]));
    this.draw(context, places);
  }

  drawSky(context: CanvasRenderingContext2D, project: (direction: Vector3) => Point | null) {
    const places = this.markers.flatMap((marker) => {
      if (marker.raDeg === null || marker.decDeg === null) return [];
      const point = project(directionFromEquatorial(marker.raDeg, marker.decDeg));
      return point ? [{ marker, point }] : [];
    });
    this.draw(context, places);
  }

  private draw(context: CanvasRenderingContext2D, places: readonly { marker: Marker; point: Point }[]) {
    if (!places.length) return;
    context.save();
    context.strokeStyle = COLOR;
    context.fillStyle = COLOR;
    context.lineWidth = 1.5;
    context.font = canvasFont(12);
    for (const { marker, point } of places) {
      context.beginPath();
      context.arc(point.x, point.y, RADIUS_PX, 0, Math.PI * 2);
      context.stroke();
      if (places.length <= LABEL_LIMIT) context.fillText(marker.name, point.x + RADIUS_PX + 4, point.y + 4);
    }
    context.restore();
  }
}

export const targetListLayer = new TargetListLayer();
