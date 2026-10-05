type Entry = { image: HTMLImageElement; texture: WebGLTexture | null; ready: boolean; failed: boolean;
  bytes: number; touched: number; width: number; height: number };

/** Lazy, local-only assets. Failed requests are remembered until the view closes. */
export class UniverseTextureCache {
  private readonly entries = new Map<string, Entry>();
  private generation = 0;
  private frame = 0;
  readonly budgetBytes = 48 * 1024 * 1024;

  constructor(private gl: WebGLRenderingContext | null, private readonly invalidate: () => void) {}

  beginFrame(): void { this.frame += 1; }
  get bytes(): number { return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
  get loaded(): string[] { return [...this.entries].filter(([, entry]) => entry.ready).map(([url]) => url); }

  get(url: string | undefined): Entry | null {
    if (!url) return null;
    const existing = this.entries.get(url);
    if (existing) { existing.touched = this.frame; return existing.ready ? existing : null; }
    if (!url.startsWith("/textures/universe/")) return null;
    const reservation = this.gl ? 21 * 1024 * 1024 : 10 * 1024 * 1024;
    this.evict(reservation);
    if (this.entries.size >= 12 || this.bytes + reservation > this.budgetBytes) return null;
    const image = new Image();
    const generation = this.generation;
    const entry: Entry = { image, texture: null, ready: false, failed: false, bytes: reservation, touched: this.frame, width: 1, height: 1 };
    this.entries.set(url, entry);
    image.onload = () => {
      if (generation !== this.generation || this.entries.get(url) !== entry) return;
      entry.width = image.naturalWidth; entry.height = image.naturalHeight;
      if (entry.width > 2048 || entry.height > 2048 || entry.width * entry.height > 2048 * 1024) {
        entry.failed = true; entry.bytes = 0; this.invalidate(); return;
      }
      // Decoded image + mipmapped GPU storage; bound both, including pending loads.
      entry.bytes = this.gl ? entry.width * entry.height * 10 : entry.width * entry.height * 4 + 1024 * 512 * 4;
      entry.ready = true;
      this.upload(entry);
      this.invalidate();
    };
    image.onerror = () => { if (generation === this.generation) { entry.failed = true; entry.bytes = 0; this.invalidate(); } };
    image.src = url;
    return null;
  }

  contextRestored(gl: WebGLRenderingContext): void {
    this.gl = gl;
    for (const entry of this.entries.values()) { entry.texture = null; if (entry.ready) this.upload(entry); }
    this.invalidate();
  }

  clear(): void {
    this.generation += 1;
    for (const [url, entry] of this.entries) this.remove(url, entry);
  }

  private upload(entry: Entry): void {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    const texture = gl.createTexture();
    if (!texture) return;
    entry.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    const pot = (entry.width & (entry.width - 1)) === 0 && (entry.height & (entry.height - 1)) === 0;
    let source: TexImageSource = entry.image;
    if (!pot) {
      // Browser-side upload resampling gives NPOT source mosaics filtered LOD
      // and a repeating longitude seam without modifying the credited file.
      const resized = document.createElement("canvas");
      resized.width = entry.width > 1800 ? 2048 : 2 ** Math.floor(Math.log2(entry.width));
      resized.height = resized.width / 2;
      resized.getContext("2d")!.drawImage(entry.image, 0, 0, resized.width, resized.height);
      source = resized;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private evict(reserve: number, keep?: string): void {
    for (const [url, entry] of [...this.entries].sort((a, b) => a[1].touched - b[1].touched)) {
      if (this.bytes + reserve <= this.budgetBytes && this.entries.size < 12) break;
      if (url !== keep && entry.touched < this.frame) this.remove(url, entry);
    }
  }

  private remove(url: string, entry: Entry): void {
    if (entry.texture) this.gl?.deleteTexture(entry.texture);
    entry.image.onload = null; entry.image.onerror = null; entry.image.src = "";
    this.entries.delete(url);
  }
}
