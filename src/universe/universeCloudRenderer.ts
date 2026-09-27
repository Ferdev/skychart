import type { BodyOccluder } from "./universeOcclusion";
import type { SkyCamera } from "../sky/skyProjection";
import { universeCameraBasis } from "../navigation/universeNavigation";
import { parseBodyColor } from "./universeAppearanceProfiles";

export type CloudSplat = { x: number; y: number; size: number; color: string; opacity: number; distance: number; star: boolean };
const CORNERS = [-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1];

/** Sorted Gaussian quads, not hardware-limited point sprites. Dust absorbs
 * light from previously drawn, more distant gas and stars. */
export class UniverseCloudRenderer {
  private gl: WebGLRenderingContext | null;
  private fallback: CanvasRenderingContext2D | null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly colors = new Map<string, number[]>();
  private vertices = new Float32Array(0);
  private hasContent = false;

  constructor(private readonly canvas: HTMLCanvasElement, invalidate: () => void) {
    this.gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    this.fallback = this.gl ? null : canvas.getContext("2d");
    this.initialize();
    canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); this.program = null; this.buffer = null; });
    canvas.addEventListener("webglcontextrestored", () => { this.initialize(); invalidate(); });
  }

  get available(): boolean { return Boolean(this.gl && this.program && this.buffer); }

  render(points: CloudSplat[], width: number, height: number, dpr: number, camera: SkyCamera, occluders: BodyOccluder[]): void {
    const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.canvas.hidden = points.length === 0;
    if (!points.length && !this.hasContent) return;
    this.hasContent = points.length > 0;
    points.sort((a, b) => b.distance - a.distance);
    const gl = this.gl;
    if (!gl || !this.program || !this.buffer) { this.renderFallback(points, width, height, dpr); return; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!points.length) return;
    const floats = points.length * 60;
    if (this.vertices.length < floats) this.vertices = new Float32Array(floats);
    points.forEach((point, index) => {
      let color = this.colors.get(point.color);
      if (!color) { color = parseBodyColor(point.color); this.colors.set(point.color, color); }
      for (let vertex = 0; vertex < 6; vertex++) {
        const o = index * 60 + vertex * 10, cx = CORNERS[vertex * 2]!, cy = CORNERS[vertex * 2 + 1]!;
        this.vertices[o] = point.x + cx * point.size / 2; this.vertices[o+1] = point.y + cy * point.size / 2;
        this.vertices[o+2] = cx; this.vertices[o+3] = cy;
        this.vertices[o+4] = color[0]!; this.vertices[o+5] = color[1]!; this.vertices[o+6] = color[2]!;
        this.vertices[o+7] = point.opacity; this.vertices[o+8] = point.distance; this.vertices[o+9] = point.star ? 1 : 0;
      }
    });
    gl.useProgram(this.program); gl.uniform2f(this.uniforms.uResolution, width, height);
    gl.uniform1f(this.uniforms.uFocal, Math.min(width, height) / (2 * Math.tan(camera.fovDeg * Math.PI / 360)));
    const basis = universeCameraBasis(camera.yawDeg, camera.pitchDeg);
    const sphereData = new Float32Array(32), distances = new Float32Array(8), rings = new Float32Array(32);
    occluders.forEach((body, index) => {
      const d = Math.max(body.distance, body.radius * 1e-6);
      sphereData.set([body.center.x * basis.right.x + body.center.y * basis.right.y + body.center.z * basis.right.z,
        body.center.x * basis.up.x + body.center.y * basis.up.y + body.center.z * basis.up.z,
        body.center.x * basis.forward.x + body.center.y * basis.forward.y + body.center.z * basis.forward.z,
        body.radius].map((value) => value / d), index * 4); distances[index] = d;
      if (body.ringNormal) {
        const n = body.ringNormal;
        rings.set([n.x*basis.right.x+n.y*basis.right.y+n.z*basis.right.z,
          n.x*basis.up.x+n.y*basis.up.y+n.z*basis.up.z,
          n.x*basis.forward.x+n.y*basis.forward.y+n.z*basis.forward.z, 1], index*4);
      }
    });
    gl.uniform4fv(this.uniforms["uBodies[0]"], sphereData); gl.uniform1fv(this.uniforms["uDistances[0]"], distances);
    gl.uniform4fv(this.uniforms["uRings[0]"], rings);
    gl.uniform1i(this.uniforms.uBodyCount, occluders.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, this.vertices.subarray(0, floats), gl.DYNAMIC_DRAW);
    for (const [index, size, offset] of [[0,2,0], [1,2,8], [2,3,16], [3,1,28], [4,1,32], [5,1,36]]) {
      gl.enableVertexAttribArray(index!); gl.vertexAttribPointer(index!, size!, gl.FLOAT, false, 40, offset!);
    }
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, points.length * 6);
  }

  release(): void { this.vertices = new Float32Array(0); this.colors.clear(); }

  private renderFallback(points: CloudSplat[], width: number, height: number, dpr: number): void {
    const ctx = this.fallback;
    if (!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    for (const point of points) {
      const r = point.size / 2;
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, r);
      gradient.addColorStop(0, point.color); gradient.addColorStop(.35, point.color.replace("rgb(", "rgba(").replace(")", ",0.55)"));
      gradient.addColorStop(1, point.color.replace("rgb(", "rgba(").replace(")", ",0)"));
      ctx.globalAlpha = point.opacity; ctx.fillStyle = gradient; ctx.fillRect(point.x-r, point.y-r, r*2, r*2);
    }
    ctx.globalAlpha = 1;
  }

  private initialize(): void {
    const gl = this.gl;
    if (!gl) return;
    const vertex = `attribute vec2 aPosition,aCorner; attribute vec3 aColor; attribute float aOpacity,aDistance,aStar;
      uniform vec2 uResolution; varying vec2 vCorner,vPixel; varying vec3 vColor; varying float vOpacity,vDistance,vStar;
      void main(){ vec2 clip=aPosition/uResolution*2.0-1.0; gl_Position=vec4(clip.x,-clip.y,0,1);
      vCorner=aCorner; vPixel=aPosition; vColor=aColor; vOpacity=aOpacity; vDistance=aDistance; vStar=aStar; }`;
    const fragment = `precision highp float; varying vec2 vCorner,vPixel; varying vec3 vColor;
      varying float vOpacity,vDistance,vStar; uniform vec2 uResolution; uniform float uFocal;
      uniform vec4 uBodies[8],uRings[8]; uniform float uDistances[8]; uniform int uBodyCount;
      float ringOpacity(float r){if(r<1.24||r>2.32)return 0.0;
        float gap=smoothstep(1.925,1.951,r)*(1.0-smoothstep(2.015,2.035,r));
        return mix(.14,.88,smoothstep(1.24,1.52,r))*(1.0-.96*gap)*(1.0-.82*exp(-pow((r-2.245)/.006,2.0)))*(.88+.09*sin(r*193.0)+.03*sin(r*811.0));}
      void main(){ float r2=dot(vCorner,vCorner); if(r2>1.0) discard;
        float transmission=1.0;
        vec3 ray=normalize(vec3((vPixel.x-uResolution.x*.5)/uFocal,(uResolution.y*.5-vPixel.y)/uFocal,1));
        for(int i=0;i<8;i++){ if(i>=uBodyCount) break; vec3 c=uBodies[i].xyz; float along=dot(c,ray);
          vec3 offset=c-ray*along; float d=uBodies[i].w*uBodies[i].w-dot(offset,offset);
          if(d>=0.0){float t=along-sqrt(d); if(t<=0.0)t=along+sqrt(d);
            if(t>0.0 && t*uDistances[i]<vDistance) discard;}
          float denominator=dot(ray,uRings[i].xyz);
          if(uRings[i].w>.5&&abs(denominator)>.00001){float rt=dot(c,uRings[i].xyz)/denominator;
            if(rt>0.0&&rt*uDistances[i]<vDistance)transmission*=1.0-ringOpacity(length(ray*rt-c)/uBodies[i].w);}}
        float soft=(exp(-4.0*r2)-exp(-4.0))/(1.0-exp(-4.0));
        float alpha=vOpacity*mix(soft,pow(soft,.65),vStar)*transmission;
        gl_FragColor=vec4(vColor,alpha); }`;
    const shaders = [vertex, fragment].map((source, i) => {
      const shader = gl.createShader(i === 0 ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER)!;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(shader)); gl.deleteShader(shader); return null; }
      return shader;
    });
    if (!shaders[0] || !shaders[1]) return;
    const program = gl.createProgram()!;
    shaders.forEach((shader) => gl.attachShader(program, shader!));
    ["aPosition","aCorner","aColor","aOpacity","aDistance","aStar"].forEach((name, i) => gl.bindAttribLocation(program, i, name));
    gl.linkProgram(program); shaders.forEach((shader) => gl.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    this.program = program; this.buffer = gl.createBuffer();
    for (const name of ["uResolution","uFocal","uBodies[0]","uDistances[0]","uRings[0]","uBodyCount"]) this.uniforms[name] = gl.getUniformLocation(program, name);
  }
}
