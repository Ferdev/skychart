import { decodeSmp3SourceId, smp3SourceIdRange } from "../smp3SourceIds";
import { WebglPointRenderer } from "../webglPointRenderer";
import type { Body, Camera } from "./contracts";
import type { Rect, ScreenPoint } from "../geometry";

export interface AtlasDiagnostics {
  smp3SourceIdFixture(): {
    range: ReturnType<typeof smp3SourceIdRange>;
    sourceId: string | null;
    absent: ReturnType<typeof smp3SourceIdRange>;
  };
  webglClipFixture(): Promise<{
    centerAlpha: number;
    outsideAlpha: number;
    pointsInViewport: number;
    occupiedPixels: number;
    preserveDrawingBuffer: boolean | null;
    contextLossFallback: boolean | null;
  } | null>;
  selectionGeometry(): { selected: ScreenPoint | null; usable: Rect; workspaceTop: number | null; camera: Camera };
  bodyScreen(key: string): ScreenPoint | null;
  gestureState(): { activePointerIds: number[]; hadPinch: boolean };
}

declare global {
  interface Window {
    __ATLAS_BOOT__?: { objectKey?: string };
    __ATLAS_DIAGNOSTICS__?: AtlasDiagnostics;
  }
}

interface InstallDiagnosticsOptions {
  enabled: boolean;
  selectedBody: () => Body | null;
  bodyByKey: () => Map<string, Body>;
  bodyToScreen: (body: Body) => ScreenPoint;
  viewport: () => Rect;
  workspacePanel: HTMLElement;
  camera: () => Camera;
  gestureState: () => { activePointerIds: number[]; hadPinch: boolean };
}

export function installAtlasDiagnostics(options: InstallDiagnosticsOptions): void {
  if (!options.enabled) return;
  window.__ATLAS_DIAGNOSTICS__ = {
    smp3SourceIdFixture,
    webglClipFixture,
    selectionGeometry: () => {
      const body = options.selectedBody();
      const workspaceRect = options.workspacePanel.hidden ? null : options.workspacePanel.getBoundingClientRect();
      return {
        selected: body ? options.bodyToScreen(body) : null,
        usable: options.viewport(),
        workspaceTop: workspaceRect?.top ?? null,
        camera: { ...options.camera() },
      };
    },
    bodyScreen: (key) => {
      const body = options.bodyByKey().get(key);
      return body ? options.bodyToScreen(body) : null;
    },
    gestureState: options.gestureState,
  };
}

function smp3SourceIdFixture() {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setBigUint64(0, 5_931_842_930_184_739_845n, true);
  return {
    range: smp3SourceIdRange(1_000, 32 + 3 * 8 + 3 * 8, 3, 2, 1),
    sourceId: decodeSmp3SourceId(bytes),
    absent: smp3SourceIdRange(1_000, 80, 3, 2, 0),
  };
}

async function webglClipFixture() {
  const canvas = document.createElement("canvas");
  const renderer = new WebglPointRenderer(canvas);
  if (!renderer.available) return null;
  renderer.setSize(200, 200);
  renderer.setLayer("fixture", {
    kind: "rich",
    signature: "clip-fixture",
    vertices: new Float32Array([0, 0, 1, 1, 1, 30]),
    count: 1,
  });
  const stats = renderer.render({
    camera: { xAu: 0, yAu: 0, pxPerAu: 1 },
    centerX: 100,
    centerY: 100,
    width: 200,
    height: 200,
    dpr: 1,
    clip: { left: 75, top: 75, right: 125, bottom: 125 },
    measurePixels: true,
  });
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return null;
  const center = new Uint8Array(4);
  const outside = new Uint8Array(4);
  gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
  gl.readPixels(60, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, outside);
  const preserveDrawingBuffer = gl.getContextAttributes()?.preserveDrawingBuffer ?? null;
  const loseContext = gl.getExtension("WEBGL_lose_context");
  if (loseContext) {
    const unavailable = new Promise<void>((resolve) => canvas.addEventListener("point-renderer-unavailable", () => resolve(), { once: true }));
    loseContext.loseContext();
    await unavailable;
  }
  return {
    centerAlpha: center[3]!,
    outsideAlpha: outside[3]!,
    pointsInViewport: stats.pointsInViewport,
    occupiedPixels: stats.occupiedPixels,
    preserveDrawingBuffer,
    contextLossFallback: loseContext ? !renderer.available : null,
  };
}
