import type { PointRenderCamera } from "./webglPointRenderer";

export const EXPORT_MAX_WIDTH = 8000;
export const EXPORT_FOOTER_CSS_HEIGHT = 88;

export type ExportProvenance = {
  centerXAu: number;
  centerYAu: number;
  pxPerAu: number;
  epoch: string;
  catalogVersion: string;
  attribution: string;
};

export type ExportTile = {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  camera: PointRenderCamera;
};

export type ExportRequest = {
  width: number;
  viewportWidth: number;
  viewportHeight: number;
  maxTileSize: number;
  overlay: HTMLCanvasElement;
  provenance: ExportProvenance;
  renderPoints: (tile: ExportTile) => Uint8ClampedArray;
  onProgress?: (complete: number, total: number) => void;
};

export function exportDimensions(width: number, viewportWidth: number, viewportHeight: number) {
  const safeWidth = Math.max(1, Math.min(EXPORT_MAX_WIDTH, Math.round(width)));
  const scale = safeWidth / Math.max(1, viewportWidth);
  return { width: safeWidth, mapHeight: Math.max(1, Math.round(viewportHeight * scale)), footerHeight: Math.round(EXPORT_FOOTER_CSS_HEIGHT * Math.max(1, scale)), scale };
}

export async function composeAtlasPng(request: ExportRequest): Promise<Blob> {
  const size = exportDimensions(request.width, request.viewportWidth, request.viewportHeight);
  const output = document.createElement("canvas");
  output.width = size.width;
  output.height = size.mapHeight + size.footerHeight;
  const context = output.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas export is unavailable.");
  context.fillStyle = "#080a09";
  context.fillRect(0, 0, output.width, output.height);
  const tileSize = Math.max(1, Math.min(request.maxTileSize, 2048));
  const columns = Math.ceil(size.width / tileSize);
  const rows = Math.ceil(size.mapHeight / tileSize);
  const total = columns * rows;
  let complete = 0;
  for (let top = 0; top < size.mapHeight; top += tileSize) {
    for (let left = 0; left < size.width; left += tileSize) {
      const width = Math.min(tileSize, size.width - left);
      const height = Math.min(tileSize, size.mapHeight - top);
      const camera = {
        xAu: request.provenance.centerXAu + (left + width / 2 - size.width / 2) / (request.provenance.pxPerAu * size.scale),
        yAu: request.provenance.centerYAu - (top + height / 2 - size.mapHeight / 2) / (request.provenance.pxPerAu * size.scale),
        pxPerAu: request.provenance.pxPerAu * size.scale
      };
      const pixels = request.renderPoints({ left, top, width, height, scale: size.scale, camera });
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), left, top);
      complete += 1;
      request.onProgress?.(complete, total);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }
  context.drawImage(request.overlay, 0, 0, request.overlay.width, request.overlay.height, 0, 0, size.width, size.mapHeight);
  drawProvenanceFooter(context, size.width, size.mapHeight, size.footerHeight, request.provenance, size.scale);
  return await new Promise<Blob>((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png"));
}

export function drawProvenanceFooter(context: CanvasRenderingContext2D, width: number, top: number, height: number, provenance: ExportProvenance, scale: number) {
  const unit = Math.max(1, scale);
  const padding = 18 * unit;
  context.fillStyle = "#101512";
  context.fillRect(0, top, width, height);
  context.fillStyle = "#efc468";
  context.font = `600 ${15 * unit}px system-ui, sans-serif`;
  context.fillText("COSMIC ATLAS", padding, top + 27 * unit);
  context.fillStyle = "#d7ded8";
  context.font = `${10 * unit}px ui-monospace, monospace`;
  const center = `CENTER ${formatCoordinate(provenance.centerXAu)} AU, ${formatCoordinate(provenance.centerYAu)} AU`;
  const scaleBarAu = niceScaleBarAu(provenance.pxPerAu, 120);
  context.fillText(`${center}  ·  SCALE ${formatCoordinate(scaleBarAu)} AU / ${(scaleBarAu * provenance.pxPerAu).toFixed(0)} px`, padding, top + 47 * unit);
  context.fillText(`EPOCH ${provenance.epoch || "unknown"}  ·  CATALOG ${provenance.catalogVersion || "unknown"}`, padding, top + 64 * unit);
  context.fillStyle = "#87928a";
  context.fillText(provenance.attribution, padding, top + 80 * unit);
}

export function niceScaleBarAu(pxPerAu: number, desiredPixels: number) {
  const raw = desiredPixels / Math.max(pxPerAu, Number.MIN_VALUE);
  const exponent = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((factor) => factor * exponent).find((value) => value >= raw) ?? raw;
}

function formatCoordinate(value: number) {
  if (!Number.isFinite(value)) return "unknown";
  const magnitude = Math.abs(value);
  return magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-3) ? value.toExponential(4) : value.toLocaleString("en-US", { maximumFractionDigits: 5, useGrouping: false });
}
