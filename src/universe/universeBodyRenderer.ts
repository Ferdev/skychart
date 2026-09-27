import { universeCameraBasis } from "../navigation/universeNavigation";
import type { SkyCamera, Vector3 } from "../sky/skyProjection";
import { AU_KM, hasRenderableRadius, projectPhysicalBody, type PhysicalBody, type ProjectedBody } from "./universeBodyGeometry";

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// Each pixel casts a camera ray into a radius-one sphere. This keeps nearby
// limbs and the horizon correct even when the sphere fills the whole view.
const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uResolution;
uniform float uFocal;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uCenter;
uniform vec3 uSun;
uniform vec3 uBase;
uniform float uMaterial;

vec3 surfaceColor(vec3 n) {
  float lon = atan(n.y, n.x);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  if (uMaterial < 0.5) return uBase;
  if (uMaterial < 1.5) {
    float waves = sin(lat * 36.0 + 0.24 * sin(lon * 5.0)) * 0.55
      + sin(lat * 82.0 - 0.17 * sin(lon * 7.0)) * 0.18;
    vec3 cloud = mix(vec3(0.89, 0.77, 0.59), vec3(0.61, 0.36, 0.24), smoothstep(-0.2, 0.55, waves));
    // Finer cloud swirls become visible only at close range; from afar they
    // would alias into a false surface pattern.
    float closeDetail = 1.0 - smoothstep(1.05, 4.0, length(uCenter));
    float eddy = sin(lat * 11800.0 + 2.2 * sin(lon * 7400.0 + lat * 3100.0))
      * sin(lon * 9200.0 - 1.7 * sin(lat * 6700.0));
    cloud *= 1.0 + closeDetail * eddy * 0.28;
    float spot = 1.0 - smoothstep(0.12, 0.19, length(vec2(sin(lon - 0.55) * 0.7, (lat + 0.35) * 1.5)));
    return mix(cloud, vec3(0.65, 0.29, 0.20), spot * 0.75);
  }
  if (uMaterial < 2.5) {
    float band = sin(lat * 42.0 + 0.15 * sin(lon * 4.0));
    return mix(vec3(0.84, 0.74, 0.55), vec3(0.68, 0.54, 0.37), smoothstep(-0.3, 0.6, band));
  }
  if (uMaterial < 3.5) {
    float land = sin(lon * 3.0 + sin(lat * 4.0)) * cos(lat * 3.0 - lon * 0.5)
      + 0.34 * sin(lon * 9.0 + lat * 7.0);
    vec3 ground = mix(vec3(0.10, 0.30, 0.61), vec3(0.30, 0.48, 0.25), smoothstep(0.08, 0.28, land));
    float cloud = smoothstep(0.75, 0.9, sin(lon * 12.0 + lat * 8.0) * sin(lat * 13.0 - lon * 3.0));
    return mix(ground, vec3(0.92, 0.95, 0.92), cloud * 0.65);
  }
  if (uMaterial < 4.5) {
    float terrain = sin(lon * 7.0 + lat * 3.0) * sin(lat * 11.0 - lon * 2.0);
    vec3 rusty = mix(vec3(0.66, 0.29, 0.16), vec3(0.40, 0.20, 0.13), smoothstep(0.05, 0.55, terrain));
    return mix(rusty, vec3(0.88, 0.82, 0.73), smoothstep(1.2, 1.45, abs(lat)));
  }
  if (uMaterial < 5.5) return uBase * (0.94 + 0.06 * sin(lat * 24.0));
  if (uMaterial < 6.5) return mix(uBase, vec3(0.97, 0.88, 0.69), 0.35 + 0.18 * sin(lat * 18.0));
  float terrain = sin(lon * 11.0) * sin(lat * 13.0 + lon * 3.0);
  return uBase * (0.82 + 0.18 * terrain);
}

void main() {
  vec2 pixel = gl_FragCoord.xy - uResolution * 0.5;
  vec3 ray = normalize(uForward + uRight * pixel.x / uFocal + uUp * pixel.y / uFocal);
  float along = dot(ray, uCenter);
  float discriminant = along * along - (dot(uCenter, uCenter) - 1.0);
  float sphereT = -1.0;
  if (discriminant >= 0.0) {
    sphereT = along - sqrt(discriminant);
    if (sphereT < 0.0) sphereT = along + sqrt(discriminant);
  }

  if (uMaterial > 1.5 && uMaterial < 2.5) {
    vec3 ringNormal = normalize(vec3(0.18, 0.43, 0.88));
    float denominator = dot(ray, ringNormal);
    if (abs(denominator) > 0.0001) {
      float ringT = dot(uCenter, ringNormal) / denominator;
      float ringRadius = length(ray * ringT - uCenter);
      if (ringT > 0.0 && ringRadius > 1.22 && ringRadius < 2.36 && (sphereT < 0.0 || ringT < sphereT)) {
        float gap = smoothstep(0.05, 0.14, abs(ringRadius - 1.86));
        float stripe = 0.73 + 0.18 * sin(ringRadius * 42.0);
        vec3 ring = vec3(0.79, 0.70, 0.53) * stripe * gap;
        gl_FragColor = vec4(ring, 0.86 * gap);
        return;
      }
    }
  }

  if (sphereT < 0.0) discard;
  vec3 normal = normalize(ray * sphereT - uCenter);
  vec3 color = surfaceColor(normal);
  if (uMaterial < 0.5) {
    float limb = max(0.0, dot(normal, -ray));
    gl_FragColor = vec4(color * (0.8 + 0.3 * limb), 1.0);
    return;
  }
  float sunlight = dot(normal, uSun);
  float diffuse = 0.12 + 0.88 * max(0.0, sunlight);
  float viewLimb = max(0.0, dot(normal, -ray));
  color *= diffuse * (0.79 + 0.21 * viewLimb);
  float specular = pow(max(0.0, dot(reflect(-uSun, normal), -ray)), 36.0);
  color += vec3(0.10) * specular * max(0.0, sunlight);
  gl_FragColor = vec4(color, 1.0);
}
`;

export class UniverseBodyRenderer {
  private readonly gl: WebGLRenderingContext | null;
  private readonly fallback: CanvasRenderingContext2D | null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.gl = gl;
    this.fallback = gl ? null : canvas.getContext("2d");
    if (gl) {
      this.initializeWebgl();
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.program = null;
        this.buffer = null;
      });
      canvas.addEventListener("webglcontextrestored", () => this.initializeWebgl());
    }
  }

  private initializeWebgl(): void {
    const gl = this.gl;
    if (!gl) return;
    this.program = buildProgram(gl);
    this.buffer = this.program ? gl.createBuffer() : null;
    if (!this.program) return;
    for (const name of ["uResolution", "uFocal", "uForward", "uRight", "uUp", "uCenter", "uSun", "uBase", "uMaterial"])
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
  }

  render(points: readonly PhysicalBody[], observer: Vector3, camera: SkyCamera,
    width: number, height: number, dpr: number): void {
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const bodies = points.map((body) => ({ body, projected: projectPhysicalBody(body, observer, camera, width, height) }))
      .filter((item): item is { body: PhysicalBody; projected: ProjectedBody } =>
        item.projected !== null && item.projected.radiusPx >= 2.5)
      .sort((a, b) => b.projected.distanceAu - a.projected.distanceAu);
    this.canvas.dataset.visibleBodies = bodies.map((item) => item.body.key).join(",");
    this.canvas.dataset.largestRadiusPx = String(Math.round(Math.max(0, ...bodies.map((item) => item.projected.radiusPx))));
    if (this.gl && this.program && this.buffer) this.renderWebgl(bodies, observer, camera, pixelWidth, pixelHeight, dpr);
    else if (this.fallback) this.renderFallback(bodies, width, height, dpr);
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
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
      const color = bodyColor(body);
      gl.uniform3f(this.uniforms.uBase, color[0], color[1], color[2]);
      gl.uniform1f(this.uniforms.uMaterial, materialCode(body));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  private renderFallback(bodies: Array<{ body: PhysicalBody; projected: ProjectedBody }>,
    width: number, height: number, dpr: number): void {
    const context = this.fallback!;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    for (const { body, projected } of bodies) {
      if (!projected.centerVisible) continue;
      const radius = Math.min(projected.radiusPx, Math.max(width, height) * 4);
      context.save();
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.clip();
      const base = body.color ?? "#a9a9a9";
      const gradient = context.createRadialGradient(projected.x - radius * 0.35, projected.y - radius * 0.35,
        radius * 0.1, projected.x, projected.y, radius * 1.2);
      gradient.addColorStop(0, "#fff0d8");
      gradient.addColorStop(0.28, base);
      gradient.addColorStop(1, "#080d13");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      if (body.key === "jupiter" || body.key === "saturn") {
        context.globalAlpha = 0.25;
        context.fillStyle = "#583522";
        for (let band = -9; band <= 9; band += 2)
          context.fillRect(projected.x - radius, projected.y + band * radius / 10, radius * 2, radius / 11);
      }
      context.restore();
    }
  }
}

function materialCode(body: PhysicalBody): number {
  if (body.key === "sun" || body.object_type === "star") return 0;
  if (body.key === "jupiter") return 1;
  if (body.key === "saturn") return 2;
  if (body.key === "earth") return 3;
  if (body.key === "mars") return 4;
  if (body.key === "uranus" || body.key === "neptune") return 5;
  if (body.key === "venus") return 6;
  return 7;
}

function bodyColor(body: PhysicalBody): [number, number, number] {
  const defaults: Record<string, string> = {
    sun: "#ffd166", earth: "#327ac0", jupiter: "#d5a87a", saturn: "#cbb88b",
    mars: "#b55a34", venus: "#e9d8a4", uranus: "#8bd2d3", neptune: "#426abd",
  };
  const hex = defaults[body.key] ?? body.color ?? "#aaaaaa";
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [0.67, 0.67, 0.67];
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
}

function normalized(value: Vector3): Vector3 {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 0 ? { x: value.x / length, y: value.y / length, z: value.z / length } : { x: 1, y: 0, z: 0 };
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((kind, index) => {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, index === 0 ? VERTEX_SHADER : FRAGMENT_SHADER);
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
