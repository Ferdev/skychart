export type PointLayerSource = {
  signature: string;
  vertices: Float32Array;
  count: number;
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
};

type PointLayer = PointLayerSource & {
  buffer: WebGLBuffer;
};

const VERTEX_STRIDE_FLOATS = 6;
const MAX_BACKGROUND_PHYSICAL_POINT_PX = 96.0;
const MAX_WEBGL_POINTS_PER_FRAME = 280_000;

export class WebglPointRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly available: boolean;

  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private worldLocation = 0;
  private colorLocation = 1;
  private radiusLocation = 2;
  private cameraLocation: WebGLUniformLocation | null = null;
  private pxPerAuLocation: WebGLUniformLocation | null = null;
  private centerLocation: WebGLUniformLocation | null = null;
  private resolutionLocation: WebGLUniformLocation | null = null;
  private layers = new Map<string, PointLayer>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.available = this.initialize();
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
        gl.deleteBuffer(existing.buffer);
        this.layers.delete(id);
      }
      return;
    }

    if (existing?.signature === source.signature) return;
    if (existing) gl.deleteBuffer(existing.buffer);

    const buffer = gl.createBuffer();
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, source.vertices, gl.STATIC_DRAW);
    this.layers.set(id, { ...source, buffer });
  }

  render(options: PointRenderOptions) {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program) return;

    gl.viewport(0, 0, options.width, options.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.layers.size === 0) return;

    gl.useProgram(program);
    gl.uniform2f(this.cameraLocation, options.camera.xAu, options.camera.yAu);
    gl.uniform1f(this.pxPerAuLocation, options.camera.pxPerAu);
    gl.uniform2f(this.centerLocation, options.centerX, options.centerY);
    gl.uniform2f(this.resolutionLocation, options.width, options.height);

    let pointsDrawn = 0;
    for (const layer of Array.from(this.layers.values())) {
      if (pointsDrawn >= MAX_WEBGL_POINTS_PER_FRAME) break;
      const drawCount = Math.min(layer.count, MAX_WEBGL_POINTS_PER_FRAME - pointsDrawn);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      gl.enableVertexAttribArray(this.worldLocation);
      gl.vertexAttribPointer(this.worldLocation, 2, gl.FLOAT, false, VERTEX_STRIDE_FLOATS * 4, 0);
      gl.enableVertexAttribArray(this.colorLocation);
      gl.vertexAttribPointer(this.colorLocation, 3, gl.FLOAT, false, VERTEX_STRIDE_FLOATS * 4, 2 * 4);
      gl.enableVertexAttribArray(this.radiusLocation);
      gl.vertexAttribPointer(this.radiusLocation, 1, gl.FLOAT, false, VERTEX_STRIDE_FLOATS * 4, 5 * 4);
      gl.drawArrays(gl.POINTS, 0, drawCount);
      pointsDrawn += drawCount;
    }
  }

  clear() {
    const gl = this.gl;
    if (!gl) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private initialize() {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance"
    });
    if (!gl) return false;

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) return false;

    this.gl = gl;
    this.program = program;
    this.worldLocation = gl.getAttribLocation(program, "a_world");
    this.colorLocation = gl.getAttribLocation(program, "a_color");
    this.radiusLocation = gl.getAttribLocation(program, "a_radius_au");
    this.cameraLocation = gl.getUniformLocation(program, "u_camera");
    this.pxPerAuLocation = gl.getUniformLocation(program, "u_px_per_au");
    this.centerLocation = gl.getUniformLocation(program, "u_center");
    this.resolutionLocation = gl.getUniformLocation(program, "u_resolution");

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
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

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
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
  attribute vec3 a_color;
  attribute float a_radius_au;

  uniform vec2 u_camera;
  uniform float u_px_per_au;
  uniform vec2 u_center;
  uniform vec2 u_resolution;

  varying vec4 v_color;

  void main() {
    vec2 screen = vec2(
      u_center.x + (a_world.x - u_camera.x) * u_px_per_au,
      u_center.y - (a_world.y - u_camera.y) * u_px_per_au
    );
    vec2 clip = vec2(
      screen.x / u_resolution.x * 2.0 - 1.0,
      1.0 - screen.y / u_resolution.y * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);
    float physicalDiameterPx = a_radius_au * u_px_per_au * 2.0;
    gl_PointSize = clamp(max(2.6, physicalDiameterPx), 2.6, ${MAX_BACKGROUND_PHYSICAL_POINT_PX.toFixed(1)});
    v_color = vec4(a_color.rgb, 0.82);
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;

  varying vec4 v_color;

  void main() {
    vec2 delta = gl_PointCoord - vec2(0.5);
    float falloff = smoothstep(0.5, 0.16, length(delta));
    if (falloff <= 0.01) discard;
    gl_FragColor = vec4(v_color.rgb, v_color.a * falloff);
  }
`;
