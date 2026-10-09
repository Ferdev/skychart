export const BODY_VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// Camera-relative, radius-one analytic spheres: no world-coordinate floats on
// the GPU. Texture relief changes normals only, never the catalog radius.
export const BODY_FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uResolution;
uniform float uFocal;
uniform vec3 uForward, uRight, uUp, uCenter, uSun, uBase;
uniform mat3 uRotation;
uniform float uMaterial, uOpacity, uAtmosphere, uRelief, uHasMap, uHasDetail;
uniform vec2 uTexel;
uniform sampler2D uMap, uDetail;
const float PI = 3.14159265359;

float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(.1,.2,.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float terrain(vec3 p) { return noise(p*7.0)*.55 + noise(p*21.0)*.3 + noise(p*63.0)*.15; }
vec2 uvFor(vec3 n) { return vec2(fract(atan(n.y,n.x)/(2.0*PI)+.5), asin(clamp(n.z,-1.0,1.0))/PI+.5); }
float sphereHit(vec3 ray, vec3 center, float radius) {
  float along = dot(ray,center), d = along*along-dot(center,center)+radius*radius;
  if (d < 0.0) return -1.0;
  float near = along-sqrt(d); return near > 0.0 ? near : along+sqrt(d);
}
float ringOpacity(float radius) {
  if (radius < 1.24 || radius > 2.32) return 0.0;
  float cRing = smoothstep(1.24,1.52,radius);
  float cassini = smoothstep(1.925,1.951,radius)*(1.0-smoothstep(2.015,2.035,radius));
  float encke = 1.0-.82*exp(-pow((radius-2.245)/.006,2.0));
  float bands = .88+.09*sin(radius*193.0)+.03*sin(radius*811.0);
  return mix(.14,.88,cRing)*(1.0-.96*cassini)*encke*bands;
}
float heightAt(vec3 n) {
  return uHasDetail > .5 && uMaterial > 6.5 ? texture2D(uDetail,uvFor(n)).r : terrain(n);
}
vec3 albedo(vec3 n) {
  if (uHasMap > .5) {
    vec2 uv = uvFor(n);
    vec3 c = texture2D(uMap,uv).rgb;
    float seam = 1.0-smoothstep(0.0,.008,min(uv.x,1.0-uv.x));
    c = mix(c,.5*(texture2D(uMap,vec2(.008,uv.y)).rgb+texture2D(uMap,vec2(.992,uv.y)).rgb),seam);
    // Hubble's 2019 mosaic lacks the polar caps above 80 degrees.
    if (uMaterial > .5 && uMaterial < 1.5) c = mix(c,uBase*.7,smoothstep(.970,.984,abs(n.z)));
    return c;
  }
  if (uMaterial < .5) return uBase*(.93+.09*noise(n*180.0));
  float t = terrain(n);
  if (uMaterial < 2.5) {
    float lat = asin(clamp(n.z,-1.0,1.0));
    float band = sin(lat*39.0 + noise(n*12.0)*.55)*.5+.5;
    return uBase * (.72+.28*band) * (.94+.12*t);
  }
  if (uMaterial > 4.5 && uMaterial < 6.5) return uBase*(.94+.09*t);
  // Material 9: an exoplanet. No surface is known, so the sphere is uniform.
  if (uMaterial > 8.5) return uBase;
  return uBase*(.65+.55*t);
}
vec3 shade(vec3 n, vec3 view, vec3 sun) {
  vec3 color = albedo(n);
  float mu = max(0.0,dot(n,view));
  if (uMaterial < .5) return color*pow(.36+.64*mu,.45);
  vec3 normal = n;
  if (uRelief > 0.0) {
    vec3 tangent = normalize(cross(abs(n.z) < .99 ? vec3(0,0,1) : vec3(0,1,0),n));
    vec3 bitangent = cross(n,tangent);
    float e = max(.002,uTexel.x*6.28), h = heightAt(n);
    normal = normalize(n-uRelief*((heightAt(normalize(n+e*tangent))-h)*tangent
      +(heightAt(normalize(n+e*bitangent))-h)*bitangent)/e);
  }
  float light = max(0.0,dot(normal,sun));
  float shadow = 1.0;
  if (uMaterial > 1.5 && uMaterial < 2.5 && abs(sun.z) > .0001) {
    float t = -n.z/sun.z;
    if (t > 0.0) shadow = 1.0-ringOpacity(length(n+sun*t))*.9;
  }
  // Decode the display map, shade in linear light, then encode for the canvas.
  vec3 linear = pow(max(color,vec3(0)),vec3(2.2));
  float diffuse = uMaterial > 6.5 && uMaterial < 8.5 ? light/(max(.18,light+mu)) : light;
  linear *= .009 + .99*diffuse*shadow;
  if (uMaterial > 2.5 && uMaterial < 3.5) {
    float cloud = uHasDetail > .5 ? texture2D(uDetail,uvFor(n)).r : 0.0;
    float ocean = smoothstep(.02,.14,color.b-color.r)*(1.0-cloud);
    float specular = pow(max(0.0,dot(reflect(-sun,normal),view)),75.0)*ocean*.4*light;
    linear += vec3(specular);
    linear = mix(linear,vec3(.83)*(.009+light),smoothstep(.18,.9,cloud)*.9);
  }
  linear += vec3(.05,.19,.45)*uAtmosphere*pow(1.0-mu,4.0)*pow(max(0.0,dot(n,sun)+.22),.5)*.4;
  return pow(max(linear,vec3(0)),vec3(1.0/2.2));
}
void main() {
  vec2 pixel = gl_FragCoord.xy-uResolution*.5;
  vec3 worldRay = normalize(uForward+uRight*pixel.x/uFocal+uUp*pixel.y/uFocal);
  vec3 ray = uRotation*worldRay, center = uRotation*uCenter, sun = uRotation*uSun;
  float t = sphereHit(ray,center,1.0);
  vec3 color = vec3(0); float alpha = 0.0;
  if (t > 0.0) { color = shade(normalize(ray*t-center),-ray,sun); alpha = 1.0; }
  else if (uAtmosphere > 0.0 || uMaterial < .5) {
    float a = dot(ray,center);
    float limb = length(ray*max(0.0,a)-center);
    if (a > 0.0 && limb < 1.08) {
      vec3 n = normalize(ray*a-center);
      alpha = exp(-(limb-1.0)*(uMaterial < .5 ? 70.0 : 140.0))*.16;
      color = uMaterial < .5 ? uBase : vec3(.2,.5,.95);
      if (uMaterial > .5) alpha *= uAtmosphere*max(0.0,dot(n,sun)+.15);
    }
  }
  if (uMaterial > 1.5 && uMaterial < 2.5 && abs(ray.z) > .00001) {
    float rt = center.z/ray.z;
    vec3 hit = ray*rt-center;
    float opacity = ringOpacity(length(hit));
    if (rt > 0.0 && opacity > .001 && (t < 0.0 || rt < t)) {
      float shadow = sphereHit(sun,-hit,1.002) > 0.0 ? .08 : 1.0;
      float illumination = .25+.75*sqrt(abs(sun.z));
      vec3 ring = vec3(.77,.71,.60)*sqrt(shadow*illumination)*(.88+.12*sin(length(hit)*91.0));
      color = (ring*opacity+color*alpha*(1.0-opacity))/max(.001,opacity+alpha*(1.0-opacity));
      alpha = opacity+alpha*(1.0-opacity);
    }
  }
  if (alpha < .001) discard;
  gl_FragColor = vec4(color,alpha*uOpacity);
}
`;
