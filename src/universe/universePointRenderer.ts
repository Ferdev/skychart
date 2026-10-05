export type UniverseScreenPoint = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  color: string;
};

/** Draw projected catalog points over the 2D backdrop in one WebGL batch. */
export class UniversePointRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private resolution: WebGLUniformLocation | null = null;
  private dpr: WebGLUniformLocation | null = null;
  private colorCache = new Map<string, readonly [number, number, number]>();
  private hasContent = false;

  constructor(private readonly canvas: HTMLCanvasElement, invalidate: () => void = () => {}) {
    this.initialize();
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.gl = null;
      this.program = null;
      this.buffer = null;
    });
    canvas.addEventListener("webglcontextrestored", () => { this.initialize(); invalidate(); });
  }

  get available(): boolean { return Boolean(this.gl && this.program && this.buffer); }

  /** True when WebGL runs on a CPU rasterizer such as SwiftShader or llvmpipe. */
  get software(): boolean {
    const gl = this.gl;
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = `${gl.getParameter(gl.RENDERER)} ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ""}`;
    return /swiftshader|llvmpipe|software/i.test(renderer);
  }

  render(points: readonly UniverseScreenPoint[], width: number, height: number, dpr: number): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.buffer) return;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.canvas.hidden = points.length === 0;
    if (!points.length && !this.hasContent) return;
    this.hasContent = points.length > 0;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const vertices = new Float32Array(points.length * 7);
    points.forEach((point, index) => {
      const offset = index * 7;
      const color = this.rgb(point.color);
      vertices[offset] = point.x;
      vertices[offset + 1] = point.y;
      vertices[offset + 2] = color[0];
      vertices[offset + 3] = color[1];
      vertices[offset + 4] = color[2];
      vertices[offset + 5] = point.size;
      vertices[offset + 6] = point.opacity;
    });
    gl.useProgram(this.program);
    gl.uniform2f(this.resolution, width, height);
    gl.uniform1f(this.dpr, dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 8);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 20);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 28, 24);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.enableVertexAttribArray(3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, points.length);
  }

  private rgb(color: string): readonly [number, number, number] {
    const cached = this.colorCache.get(color);
    if (cached) return cached;
    const channels = color.match(/\d+/g)?.map(Number) ?? [235, 225, 205];
    const rgb: readonly [number, number, number] = [channels[0]! / 255, channels[1]! / 255, channels[2]! / 255];
    this.colorCache.set(color, rgb);
    return rgb;
  }

  private initialize(): void {
    const gl = this.canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;
    const vertex = this.shader(gl, gl.VERTEX_SHADER, `
      attribute vec2 aPosition;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOpacity;
      uniform vec2 uResolution;
      uniform float uDpr;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        vec2 clip = aPosition / uResolution * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        gl_PointSize = max(2.0, aSize * uDpr);
        vColor = aColor;
        vOpacity = aOpacity;
      }
    `);
    const fragment = this.shader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float light = pow(max(0.0, 1.0 - radius), 1.5);
        if (light <= 0.01) discard;
        gl_FragColor = vec4(vColor, vOpacity * light);
      }
    `);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return;
    }
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.bindAttribLocation(program, 1, "aColor");
    gl.bindAttribLocation(program, 2, "aSize");
    gl.bindAttribLocation(program, 3, "aOpacity");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    const buffer = gl.createBuffer();
    if (!buffer) { gl.deleteProgram(program); return; }
    this.gl = gl;
    this.program = program;
    this.buffer = buffer;
    this.resolution = gl.getUniformLocation(program, "uResolution");
    this.dpr = gl.getUniformLocation(program, "uDpr");
  }

  private shader(gl: WebGLRenderingContext, kind: number, source: string): WebGLShader | null {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }
}
