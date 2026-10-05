const MIN_LEVEL = 0.4;
const SLOW_FRAME_MS = 45;
const VERY_SLOW_FRAME_MS = 90;
const FAST_FRAME_MS = 38;
const FRAMES_TO_RAISE = 45;
const HOLD_AFTER_LOWER_MS = 2_000;

/** Detail level for the 3D layers while the scene animates. Detail stays full
 * unless consecutive frames run slow, so a capable GPU never shows a
 * low-resolution scene in motion and a slow one stays responsive. A still
 * scene always renders at full detail. */
export class UniverseRenderQuality {
  private level: number;
  private lastFrameAt = 0;
  private wasAnimating = false;
  private slowScore = 0;
  private fastFrames = 0;
  private holdUntil = 0;

  /** A software rasterizer cannot afford full detail in motion; start it low. */
  constructor(startLow = false) { this.level = startLow ? MIN_LEVEL : 1; }

  /** Call once per rendered frame with its timestamp in milliseconds. */
  frame(now: number, animating: boolean): number {
    const interval = now - this.lastFrameAt;
    const continuous = animating && this.wasAnimating;
    this.lastFrameAt = now;
    this.wasAnimating = animating;
    if (!animating) return 1;
    if (!continuous) return this.level;
    if (interval > SLOW_FRAME_MS) {
      // One long frame is often a catalog refresh, not the GPU: require a run.
      this.fastFrames = 0;
      this.slowScore += interval > VERY_SLOW_FRAME_MS ? 2 : 1;
      if (this.slowScore >= 3) {
        this.level = Math.max(MIN_LEVEL, this.level * (interval > VERY_SLOW_FRAME_MS ? 0.6 : 0.8));
        this.slowScore = 0;
        this.holdUntil = now + HOLD_AFTER_LOWER_MS;
      }
    } else {
      this.slowScore = 0;
      if (interval < FAST_FRAME_MS && now >= this.holdUntil && ++this.fastFrames >= FRAMES_TO_RAISE) {
        this.level = Math.min(1, this.level * 1.12);
        this.fastFrames = 0;
      }
    }
    return this.level;
  }
}
