import { turnCameraToward } from "../navigation/universeFlight";
import { cameraForDirection, type SkyCamera, type Vector3 } from "../sky/skyProjection";

type CameraTurnOptions = {
  camera: () => SkyCamera;
  setCamera: (camera: SkyCamera) => void;
  /** Direction to look at, or null when there is no target any more. */
  direction: () => Vector3 | null;
  afterFrame: () => void;
};

/** A turn stops after this time, also when the eased turn did not reach the direction. */
const MAX_TURN_MS = 1_500;

/** Turns the 3D camera to a direction in a short eased motion. It does not move the observer. */
export class UniverseCameraTurn {
  private frame: number | null = null;

  constructor(private readonly options: CameraTurnOptions) {}

  start(): void {
    this.cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.finish();
      return;
    }
    const startedAt = performance.now();
    let last = startedAt;
    const tick = (now: number) => {
      this.frame = null;
      const direction = this.options.direction();
      if (!direction) return;
      const camera = this.options.camera();
      const goal = cameraForDirection(direction, camera.fovDeg);
      const next = now - startedAt >= MAX_TURN_MS ? goal : turnCameraToward(camera, direction, Math.max(0, now - last) / 1000);
      last = now;
      this.options.setCamera(next);
      this.options.afterFrame();
      if (next.yawDeg !== goal.yawDeg || next.pitchDeg !== goal.pitchDeg) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Stops the turn, for example when the user starts to look around. */
  cancel(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private finish(): void {
    const direction = this.options.direction();
    if (!direction) return;
    this.options.setCamera(cameraForDirection(direction, this.options.camera().fovDeg));
    this.options.afterFrame();
  }
}
