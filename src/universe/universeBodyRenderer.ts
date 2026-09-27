import { universeCameraBasis } from "../navigation/universeNavigation";
import type { SkyCamera, Vector3 } from "../sky/skyProjection";
import { AU_KM, projectPhysicalBody, projectSphericalExtent, type PhysicalBody, type ProjectedBody } from "./universeBodyGeometry";

import { BODY_VERTEX_SHADER, BODY_FRAGMENT_SHADER } from "./universeBodyShaders";
import { appearanceRotation, bodyAppearance, resolvedBodyWeight } from "./universeAppearanceProfiles";
import { UniverseTextureCache } from "./universeTextureCache";
import { renderBodyFallback } from "./universeBodyFallback";

export class UniverseBodyRenderer {
  private readonly gl: WebGLRenderingContext | null;
  private readonly fallback: CanvasRenderingContext2D | null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};

  private readonly textures: UniverseTextureCache;
  private blankTexture: WebGLTexture | null = null;
  private hasContent = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly invalidate: () => void = () => {}) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.gl = gl;
    this.textures = new UniverseTextureCache(gl, invalidate);
    this.fallback = gl ? null : canvas.getContext("2d");
    if (gl) {
      this.initializeWebgl();
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.program = null;
        this.buffer = null;
      });
      canvas.addEventListener("webglcontextrestored", () => {
        this.initializeWebgl(); this.textures.contextRestored(gl);
      });
    }
  }

  private initializeWebgl(): void {
    const gl = this.gl;
    if (!gl) return;
    this.program = buildProgram(gl);
    this.buffer = this.program ? gl.createBuffer() : null;
    if (!this.program) return;
    for (const name of ["uResolution", "uFocal", "uForward", "uRight", "uUp", "uCenter", "uSun", "uBase", "uMaterial", "uRotation", "uOpacity", "uAtmosphere", "uRelief", "uHasMap", "uHasDetail", "uTexel", "uMap", "uDetail"])
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    this.blankTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blankTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128,128,128,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  render(points: readonly PhysicalBody[], observer: Vector3, camera: SkyCamera,
    width: number, height: number, dpr: number, moving = false): void {
    const bodies = points.map((body) => ({ body, projected: projectPhysicalBody(body, observer, camera, width, height)
      ?? (body.key === "saturn" ? projectSphericalExtent(body.position, Number(body.radiusKm) / AU_KM * 2.32, observer, camera, width, height) : null) }))
      .filter((item): item is { body: PhysicalBody; projected: ProjectedBody } =>
        item.projected !== null && item.projected.radiusPx > 1.5)
      .sort((a, b) => b.projected.distanceAu - a.projected.distanceAu);
    // Bound fragment work when a surface fills the viewport. Navigation and
    // angular extents stay in CSS pixels; stopping restores close-up detail.
    const pixelBudget = moving ? 400_000 : bodies.some((item) => item.projected.inside) ? 600_000 : 2_000_000;
    dpr = Math.min(dpr, Math.sqrt(pixelBudget / Math.max(1, width * height)));
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.canvas.dataset.visibleBodies = bodies.map((item) => item.body.key).join(",");
    this.canvas.dataset.largestRadiusPx = String(Math.round(Math.max(0, ...bodies.map((item) => item.projected.radiusPx))));
    this.canvas.hidden = bodies.length === 0;
    this.textures.beginFrame();
    if (bodies.length || this.hasContent) {
      if (this.gl && this.program && this.buffer) this.renderWebgl(bodies, observer, camera, pixelWidth, pixelHeight, dpr);
      else if (this.fallback) renderBodyFallback(this.fallback, bodies, observer, camera, width, height, dpr, this.textures);
    }
    this.hasContent = bodies.length > 0;
    this.canvas.dataset.textureBytes = String(this.textures.bytes);
    this.canvas.dataset.loadedTextures = this.textures.loaded.map((url) => url.split("/").pop()).join(",");
    this.canvas.dataset.renderer = this.gl ? "webgl" : "canvas";
  }

  private renderWebgl(bodies: Array<{ body: PhysicalBody; projected: ProjectedBody }>, observer: Vector3,
    camera: SkyCamera, width: number, height: number, dpr: number): void {
    const gl = this.gl!;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program!, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const basis = universeCameraBasis(camera.yawDeg, camera.pitchDeg);
    gl.uniform2f(this.uniforms.uResolution, width, height);
    gl.uniform1f(this.uniforms.uFocal, Math.min(width, height) / (2 * Math.tan(camera.fovDeg * Math.PI / 360)));
    gl.uniform3f(this.uniforms.uForward, basis.forward.x, basis.forward.y, basis.forward.z);
    gl.uniform3f(this.uniforms.uRight, basis.right.x, basis.right.y, basis.right.z);
    gl.uniform3f(this.uniforms.uUp, basis.up.x, basis.up.y, basis.up.z);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    for (const { body, projected } of bodies) {
      const extent = projected.radiusPx * (body.key === "saturn" ? 3 : 1.5);
      if (projected.centerVisible && !projected.inside && projected.x >= 0 && projected.x <= width / dpr &&
        projected.y >= 0 && projected.y <= height / dpr && extent < Math.max(width, height) * 2) {
        const left = Math.max(0, Math.floor((projected.x - extent) * dpr));
        const right = Math.min(width, Math.ceil((projected.x + extent) * dpr));
        const top = Math.max(0, Math.floor((projected.y - extent) * dpr));
        const bottom = Math.min(height, Math.ceil((projected.y + extent) * dpr));
        if (right <= left || bottom <= top) continue;
        gl.scissor(left, height - bottom, right - left, bottom - top);
      } else gl.scissor(0, 0, width, height);
      const radiusAu = Number(body.radiusKm) / AU_KM;
      gl.uniform3f(this.uniforms.uCenter, (body.position.x - observer.x) / radiusAu,
        (body.position.y - observer.y) / radiusAu, (body.position.z - observer.z) / radiusAu);
      const light = normalized({ x: -body.position.x, y: -body.position.y, z: -body.position.z });
      gl.uniform3f(this.uniforms.uSun, light.x, light.y, light.z);
      const profile = bodyAppearance(body);
      const map = projected.radiusPx >= 12 ? this.textures.get(profile.map) : null;
      const detail = projected.radiusPx >= 40 ? this.textures.get(profile.detail) : null;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, map?.texture ?? this.blankTexture);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, detail?.texture ?? this.blankTexture);
      gl.uniform1i(this.uniforms.uMap, 0); gl.uniform1i(this.uniforms.uDetail, 1);
      gl.uniform1f(this.uniforms.uHasMap, map?.texture ? 1 : 0);
      gl.uniform1f(this.uniforms.uHasDetail, detail?.texture ? 1 : 0);
      gl.uniform2f(this.uniforms.uTexel, 1 / (detail?.width ?? 1024), 1 / (detail?.height ?? 512));
      gl.uniformMatrix3fv(this.uniforms.uRotation, false, appearanceRotation(profile));
      gl.uniform1f(this.uniforms.uOpacity, resolvedBodyWeight(projected.radiusPx));
      gl.uniform1f(this.uniforms.uAtmosphere, profile.atmosphere);
      gl.uniform1f(this.uniforms.uRelief, profile.relief);
      const color = profile.color;
      gl.uniform3f(this.uniforms.uBase, color[0], color[1], color[2]);
      gl.uniform1f(this.uniforms.uMaterial, profile.material);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  release(): void {
    this.textures.clear(); this.canvas.dataset.textureBytes = "0"; this.canvas.dataset.loadedTextures = "";
  }
}

function normalized(value: Vector3): Vector3 {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 0 ? { x: value.x / length, y: value.y / length, z: value.z / length } : { x: 1, y: 0, z: 0 };
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((kind, index) => {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, index === 0 ? BODY_VERTEX_SHADER : BODY_FRAGMENT_SHADER);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn("3D body shader unavailable:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  });
  if (!shaders[0] || !shaders[1]) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, shaders[0]);
  gl.attachShader(program, shaders[1]);
  gl.linkProgram(program);
  gl.deleteShader(shaders[0]);
  gl.deleteShader(shaders[1]);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("3D body program unavailable:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}
