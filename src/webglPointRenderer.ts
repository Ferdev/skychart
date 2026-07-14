export type PointLayerSource =
  | {
      kind: "rich";
      signature: string;
      vertices: Float32Array;
      count: number;
    }
  | {
      kind: "compact";
      signature: string;
      vertices: Float32Array;
      count: number;
      origin: { x: number; y: number };
      format?: "SMP2" | "SMP3";
      blend?: "additive" | "source-over";
    };

export type PointRenderCamera = {
  xAu: number;
  yAu: number;
  pxPerAu: number;
};

export type PointRenderOptions = {
  camera: PointRenderCamera;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  dpr: number;
  clip: { left: number; top: number; right: number; bottom: number };
  measureViewport?: boolean;
  measurePixels?: boolean;
};

export type PointRenderStats = {
  layerCount: number;
  pointsDrawn: number;
  pointsInViewport: number;
  occupiedPixels: number;
  capped: boolean;
};

export type PointExportLimits = {
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxTileSize: number;
};

type PointLayer = PointLayerSource & {
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject | null;
};

function countLayerPointsInViewport(layer: PointLayer, count: number, options: PointRenderOptions) {
  const stride = layer.kind === "rich" ? 6 : layer.format === "SMP3" ? 4 : 3;
  const originX = layer.kind === "compact" ? layer.origin.x : 0;
  const originY = layer.kind === "compact" ? layer.origin.y : 0;
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * stride;
    const x = options.centerX + (originX + layer.vertices[offset] - options.camera.xAu) * options.camera.pxPerAu;
    const y = options.centerY - (originY + layer.vertices[offset + 1] - options.camera.yAu) * options.camera.pxPerAu;
    if (x >= options.clip.left && x < options.clip.right && y >= options.clip.top && y < options.clip.bottom) visible += 1;
  }
  return visible;
}

const RICH_STRIDE_BYTES = 24;
const COMPACT_STRIDE_BYTES = 12;
const SMP3_COMPACT_STRIDE_BYTES = 16;
const MAX_BACKGROUND_PHYSICAL_POINT_PX = 96.0;
const MAX_WEBGL_POINTS_PER_FRAME = 4_000_000;

export class WebglPointRenderer {
  readonly canvas: HTMLCanvasElement;

  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private operational = false;
  private worldLocation = 0;
  private colorLocation = 1;
  private radiusLocation = 2;
  private magnitudeExtentLocation = 3;
  private offsetLocation: WebGLUniformLocation | null = null;
  private pxPerAuLocation: WebGLUniformLocation | null = null;
  private centerLocation: WebGLUniformLocation | null = null;
  private resolutionLocation: WebGLUniformLocation | null = null;
  private dprLocation: WebGLUniformLocation | null = null;
  private typedLocation: WebGLUniformLocation | null = null;
  private smp3Location: WebGLUniformLocation | null = null;
  private magnitudeZeroLocation: WebGLUniformLocation | null = null;
  private layers = new Map<string, PointLayer>();
  private lastStats: PointRenderStats = { layerCount: 0, pointsDrawn: 0, pointsInViewport: 0, occupiedPixels: 0, capped: false };
  private pixelReadback = new Uint8Array(0);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.addEventListener("webglcontextlost", () => {
      this.operational = false;
      this.gl = null;
      this.program = null;
      this.layers.clear();
      this.canvas.dispatchEvent(new CustomEvent("point-renderer-unavailable"));
    });
    this.operational = this.initialize();
  }

  get available() {
    return this.operational;
  }

  getExportLimits(): PointExportLimits | null {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return null;
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    const maxRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || maxTextureSize;
    return { maxTextureSize, maxRenderbufferSize, maxTileSize: Math.max(1, Math.min(maxTextureSize, maxRenderbufferSize)) };
  }

  /** Render into a private framebuffer and synchronously read it back. */
  exportPixels(options: PointRenderOptions): Uint8ClampedArray {
    const gl = this.gl;
    if (!gl || !this.program || gl.isContextLost()) throw new Error("WebGL point renderer is unavailable.");
    const limits = this.getExportLimits();
    if (!limits || options.width > limits.maxTileSize || options.height > limits.maxTileSize) {
      throw new Error(`Export tile exceeds GPU limit (${limits?.maxTileSize ?? 0}px).`);
    }
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("Unable to allocate the export framebuffer.");
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, options.width, options.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("GPU could not create a complete export framebuffer.");
      }
      this.render(options);
      const raw = new Uint8Array(options.width * options.height * 4);
      gl.readPixels(0, 0, options.width, options.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      if (gl.getError() !== gl.NO_ERROR) throw new Error("GPU readback failed during export.");
      const pixels = new Uint8ClampedArray(raw.length);
      const rowBytes = options.width * 4;
      for (let y = 0; y < options.height; y += 1) {
        pixels.set(raw.subarray(y * rowBytes, (y + 1) * rowBytes), (options.height - y - 1) * rowBytes);
      }
      return pixels;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setSize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.gl?.viewport(0, 0, width, height);
  }

  setLayer(id: string, source: PointLayerSource | null) {
    const gl = this.gl;
    if (!gl) return;

    const existing = this.layers.get(id);
    if (!source || source.count === 0) {
      if (existing) {
        if (existing.vao && gl instanceof WebGL2RenderingContext) gl.deleteVertexArray(existing.vao);
        gl.deleteBuffer(existing.buffer);
        this.layers.delete(id);
      }
      return;
    }

    if (existing?.signature === source.signature) return;
    if (existing) {
      if (existing.vao && gl instanceof WebGL2RenderingContext) gl.deleteVertexArray(existing.vao);
      gl.deleteBuffer(existing.buffer);
    }

    const buffer = gl.createBuffer();
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, source.vertices, gl.STATIC_DRAW);
    const vao = gl instanceof WebGL2RenderingContext ? gl.createVertexArray() : null;
    if (vao && gl instanceof WebGL2RenderingContext) {
      gl.bindVertexArray(vao);
      this.configureVertexAttributes(gl, source, buffer);
      gl.bindVertexArray(null);
    }
    this.layers.set(id, { ...source, buffer, vao });
  }

  render(options: PointRenderOptions): PointRenderStats {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program) return this.lastStats;
    if (gl.isContextLost()) {
      this.markUnavailable();
      return this.lastStats;
    }

    gl.viewport(0, 0, options.width, options.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.layers.size === 0) {
      this.lastStats = { layerCount: 0, pointsDrawn: 0, pointsInViewport: 0, occupiedPixels: 0, capped: false };
      return this.lastStats;
    }

    const clipLeft = Math.max(0, Math.floor(options.clip.left * options.dpr));
    const clipRight = Math.min(options.width, Math.ceil(options.clip.right * options.dpr));
    const clipTop = Math.max(0, Math.floor(options.clip.top * options.dpr));
    const clipBottom = Math.min(options.height, Math.ceil(options.clip.bottom * options.dpr));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      clipLeft,
      Math.max(0, options.height - clipBottom),
      Math.max(0, clipRight - clipLeft),
      Math.max(0, clipBottom - clipTop)
    );

    gl.useProgram(program);
    gl.uniform1f(this.pxPerAuLocation, options.camera.pxPerAu);
    gl.uniform2f(this.centerLocation, options.centerX, options.centerY);
    gl.uniform2f(this.resolutionLocation, options.width / options.dpr, options.height / options.dpr);
    gl.uniform1f(this.dprLocation, options.dpr);
    gl.uniform1f(this.magnitudeZeroLocation, Math.max(-2, Math.min(18, 7 - Math.log10(Math.max(options.camera.pxPerAu, 1e-14)) * 0.75)));

    let pointsDrawn = 0;
    const measureViewport = options.measureViewport || options.measurePixels;
    let pointsInViewport = measureViewport ? 0 : this.lastStats.pointsInViewport;
    for (const layer of this.layers.values()) {
      if (pointsDrawn >= MAX_WEBGL_POINTS_PER_FRAME) break;
      const drawCount = Math.min(layer.count, MAX_WEBGL_POINTS_PER_FRAME - pointsDrawn);
      if (measureViewport) pointsInViewport += countLayerPointsInViewport(layer, drawCount, options);
      const originX = layer.kind === "compact" ? layer.origin.x : 0;
      const originY = layer.kind === "compact" ? layer.origin.y : 0;
      gl.uniform2f(this.offsetLocation, originX - options.camera.xAu, originY - options.camera.yAu);
      if (layer.vao && gl instanceof WebGL2RenderingContext) gl.bindVertexArray(layer.vao);
      else this.configureVertexAttributes(gl, layer, layer.buffer);
      if (layer.kind === "rich") {
        gl.uniform1f(this.typedLocation, 0.0);
        gl.uniform1f(this.smp3Location, 0.0);
      } else {
        gl.uniform1f(this.typedLocation, 1.0);
        const isSmp3 = layer.format === "SMP3";
        gl.uniform1f(this.smp3Location, isSmp3 ? 1.0 : 0.0);
      }
      const additive = layer.kind === "compact" && layer.blend === "additive";
      gl.blendFunc(additive ? gl.ONE : gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, drawCount);
      if (layer.vao && gl instanceof WebGL2RenderingContext) gl.bindVertexArray(null);
      pointsDrawn += drawCount;
    }
    if (gl.getError() !== gl.NO_ERROR) {
      this.markUnavailable();
      return this.lastStats;
    }
    const occupiedPixels = options.measurePixels
      ? this.countOccupiedPixels(gl, clipLeft, clipTop, clipRight, clipBottom, options.height)
      : this.lastStats.occupiedPixels;
    this.lastStats = {
      layerCount: this.layers.size,
      pointsDrawn,
      pointsInViewport,
      occupiedPixels,
      capped: pointsDrawn >= MAX_WEBGL_POINTS_PER_FRAME
    };
    return this.lastStats;
  }

  clear() {
    const gl = this.gl;
    if (!gl) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private countOccupiedPixels(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    left: number,
    top: number,
    right: number,
    bottom: number,
    framebufferHeight: number
  ) {
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width === 0 || height === 0) return 0;
    const byteLength = width * height * 4;
    if (this.pixelReadback.length < byteLength) this.pixelReadback = new Uint8Array(byteLength);
    const pixels = this.pixelReadback.subarray(0, byteLength);
    gl.readPixels(left, framebufferHeight - bottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let occupied = 0;
    for (let offset = 3; offset < byteLength; offset += 4) {
      if (pixels[offset] > 0) occupied += 1;
    }
    return occupied;
  }

  private configureVertexAttributes(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    source: PointLayerSource,
    buffer: WebGLBuffer
  ) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(this.worldLocation);
    gl.enableVertexAttribArray(this.colorLocation);
    if (source.kind === "rich") {
      gl.vertexAttribPointer(this.worldLocation, 2, gl.FLOAT, false, RICH_STRIDE_BYTES, 0);
      gl.vertexAttribPointer(this.colorLocation, 3, gl.FLOAT, false, RICH_STRIDE_BYTES, 8);
      gl.enableVertexAttribArray(this.radiusLocation);
      gl.vertexAttribPointer(this.radiusLocation, 1, gl.FLOAT, false, RICH_STRIDE_BYTES, 20);
      gl.disableVertexAttribArray(this.magnitudeExtentLocation);
      gl.vertexAttrib2f(this.magnitudeExtentLocation, 255, 0);
      return;
    }
    const isSmp3 = source.format === "SMP3";
    const stride = isSmp3 ? SMP3_COMPACT_STRIDE_BYTES : COMPACT_STRIDE_BYTES;
    gl.vertexAttribPointer(this.worldLocation, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.UNSIGNED_BYTE, true, stride, 8);
    gl.disableVertexAttribArray(this.radiusLocation);
    gl.vertexAttrib1f(this.radiusLocation, 0);
    if (isSmp3) {
      gl.enableVertexAttribArray(this.magnitudeExtentLocation);
      gl.vertexAttribPointer(this.magnitudeExtentLocation, 2, gl.UNSIGNED_BYTE, false, stride, 12);
    } else {
      gl.disableVertexAttribArray(this.magnitudeExtentLocation);
      gl.vertexAttrib2f(this.magnitudeExtentLocation, 255, 0);
    }
  }

  private initialize() {
    const contextOptions: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // This renderer is invalidation-driven rather than a continuous game
      // loop. Without a retained drawing buffer, browsers may legally discard
      // the catalog layer after compositing and leave only the 2D labels/grid.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    };
    const gl = this.canvas.getContext("webgl2", contextOptions) ?? this.canvas.getContext("webgl", contextOptions);
    if (!gl) return false;

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) return false;

    this.gl = gl;
    this.program = program;
    this.worldLocation = gl.getAttribLocation(program, "a_world");
    this.colorLocation = gl.getAttribLocation(program, "a_color");
    this.radiusLocation = gl.getAttribLocation(program, "a_radius_au");
    this.magnitudeExtentLocation = gl.getAttribLocation(program, "a_mag_extent");
    this.offsetLocation = gl.getUniformLocation(program, "u_offset");
    this.pxPerAuLocation = gl.getUniformLocation(program, "u_px_per_au");
    this.centerLocation = gl.getUniformLocation(program, "u_center");
    this.resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    this.dprLocation = gl.getUniformLocation(program, "u_dpr");
    this.typedLocation = gl.getUniformLocation(program, "u_typed");
    this.smp3Location = gl.getUniformLocation(program, "u_smp3");
    this.magnitudeZeroLocation = gl.getUniformLocation(program, "u_magnitude_zero");

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  private markUnavailable() {
    if (!this.operational) return;
    this.operational = false;
    this.canvas.dispatchEvent(new CustomEvent("point-renderer-unavailable"));
  }
}

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("Unable to link WebGL point renderer.", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function createShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("Unable to compile WebGL point shader.", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

const VERTEX_SHADER_SOURCE = `
  precision highp float;

  attribute vec2 a_world;
  attribute vec4 a_color;
  attribute float a_radius_au;
  attribute vec2 a_mag_extent;

  uniform vec2 u_offset;
  uniform float u_px_per_au;
  uniform vec2 u_center;
  uniform vec2 u_resolution;
  uniform float u_dpr;
  uniform float u_typed;
  uniform float u_smp3;
  uniform float u_magnitude_zero;

  varying vec4 v_color;
  void main() {
    vec2 world = u_offset + a_world;
    vec2 screen = vec2(
      u_center.x + world.x * u_px_per_au,
      u_center.y - world.y * u_px_per_au
    );
    vec2 clip = vec2(
      screen.x / u_resolution.x * 2.0 - 1.0,
      1.0 - screen.y / u_resolution.y * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);

    float physicalDiameterPx = a_radius_au * u_px_per_au * 2.0;
    float magnitude = a_mag_extent.x * 0.1 - 2.0;
    float magnitudeSize = clamp(pow(1.2, u_magnitude_zero - magnitude), 1.0, 3.0);
    float extentLy = a_mag_extent.y > 0.5 ? pow(2.0, (a_mag_extent.y - 64.0) / 16.0) : 0.0;
    float extentPx = extentLy * 63241.077 * u_px_per_au * 2.0;
    float smp3Size = max(magnitudeSize, extentPx);
    gl_PointSize = clamp(max(1.0, mix(physicalDiameterPx, smp3Size, u_smp3)), 1.0, ${MAX_BACKGROUND_PHYSICAL_POINT_PX.toFixed(1)}) * u_dpr;

    float magAlpha = clamp(pow(1.12, u_magnitude_zero - magnitude), 0.55, 1.0);
    v_color = vec4(a_color.rgb, 0.9 * mix(1.0, magAlpha, u_smp3));
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;

  varying vec4 v_color;
  void main() {
    vec2 delta = gl_PointCoord - vec2(0.5);
    if (length(delta) > 0.5) discard;
    gl_FragColor = v_color;
  }
`;
