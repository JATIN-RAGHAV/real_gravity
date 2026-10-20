// shader.js — GLSL for the object. One full-screen pass: starfield (lensed for black holes),
// then a procedurally shaded sphere whose look depends on the object kind.
export const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_center;   // GL pixel coords
uniform float u_radius;   // px
uniform int   u_kind;     // 1 rock, 2 gas giant, 3 ice, 4 cloud, 5 proto, 6 star, 7 brown dwarf,
                          // 8 white dwarf, 9 neutron star, 10 black hole, 11 collapsing core, 0 nothing
uniform vec3  u_col;      // main colour (linear-ish 0..1)
uniform vec3  u_col2;     // secondary colour
uniform float u_glow;     // corona / glow strength
uniform float u_seed;
uniform float u_spin;     // rotation rate (rad/s)
uniform float u_hot;      // 0 cool .. 1 very hot (controls spots, activity)
uniform float u_pulse;    // over-pressured / unstable indicator

// ---------- noise ----------
float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
// cellular (Worley) distance for granulation and craters
float cells(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash(i + g), hash(i + g + 7.1), hash(i + g + 3.3));
    d = min(d, length(g + o - f));
  }
  return d;
}

// ---------- background ----------
vec3 stars(vec2 uv) {
  vec3 c = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sz = layer == 0 ? 26.0 : 48.0;
    vec2 cell = floor(uv / sz); vec2 f = fract(uv / sz);
    float h = hash2(cell + float(layer) * 13.1 + u_seed);
    vec2 pos = vec2(hash2(cell + 1.3 + u_seed), hash2(cell + 2.7 + u_seed));
    float on = step(0.86 - 0.08 * float(layer), h);
    float dd = length(f - pos) * sz;
    float tw = 0.85 + 0.15 * sin(u_time * (0.8 + 2.0 * h) + h * 40.0);
    float size = 0.5 + 1.6 * hash2(cell + 9.9) * float(layer + 1);
    float s = on * exp(-dd * dd / size) * (0.35 + 0.65 * h) * tw;
    vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), hash2(cell + 5.1));
    c += s * tint;
  }
  return c;
}

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 rel = frag - u_center;
  float d = length(rel) / u_radius;
  float t = d - 1.0;
  vec2 dir = d > 0.0 ? rel / (d * u_radius) : vec2(1.0, 0.0);
  float ang = atan(rel.y, rel.x);

  // background, with gravitational lensing for a black hole
  vec2 uvbg = frag;
  if (u_kind == 10) {
    float thE = u_radius * 1.45;
    float th = max(length(rel), 1.0);
    float beta = th - thE * thE / th;
    uvbg = u_center + (rel / th) * beta;
  }
  vec3 bg = vec3(0.028, 0.034, 0.055) * (1.0 - 0.35 * frag.y / u_res.y) + stars(uvbg);
  vec3 col = bg;

  if (u_kind == 0) { gl_FragColor = vec4(col, 1.0); return; }

  if (u_kind == 10) { // black hole: shadow, photon ring, faint lensed halo
    float ring = exp(-pow((d - 1.0) / 0.035, 2.0)) * 1.4 + exp(-pow((d - 1.0) / 0.18, 2.0)) * 0.35;
    vec3 ringCol = vec3(1.0, 0.86, 0.6);
    col += ringCol * ring * step(1.0, d);
    col += vec3(0.5, 0.6, 1.0) * 0.08 * exp(-max(t, 0.0) * 2.0);
    if (d < 1.0) col = vec3(0.0);
    gl_FragColor = vec4(col, 1.0); return;
  }

  if (u_kind == 4) { // diffuse cloud: no surface
    vec3 q = vec3(rel / u_radius, u_time * 0.02);
    float dens = fbm(q * 1.4 + u_seed) * exp(-d * d * 0.9);
    float dens2 = fbm(q * 3.5 + 2.0 * u_seed) * exp(-d * d * 0.6);
    vec3 cc = mix(vec3(0.35, 0.42, 0.6), vec3(0.6, 0.55, 0.7), dens2);
    col = mix(col, cc, clamp(dens * 1.6, 0.0, 0.85));
    col += cc * dens2 * 0.25;
    gl_FragColor = vec4(col, 1.0); return;
  }

  bool emissive = (u_kind == 5 || u_kind == 6 || u_kind == 8 || u_kind == 9 || u_kind == 11);

  // --- glow / corona / atmosphere rim (computed everywhere so the limb blends into it) ---
  float tt = max(t, 0.0);
  {
    if (emissive) {
      float rays = fbm(vec3(ang * 2.5, tt * 3.0 - u_time * 0.25, u_seed + 3.0));
      float rays2 = fbm(vec3(ang * 7.0 + u_time * 0.05, tt * 8.0 - u_time * 0.6, u_seed));
      float g = exp(-tt * 5.0) * (0.22 + 0.4 * rays + 0.2 * rays2) + exp(-tt * 1.3) * 0.1;
      g *= u_glow;
      if (u_kind == 11) g *= 1.0 + 0.5 * sin(u_time * 6.0);
      col += u_col * g;
      if (u_kind == 9) { // pulsar beams
        float sp = u_time * u_spin;
        float a1 = ang - sp, a2 = ang - sp - 3.14159;
        float w = 0.12;
        float beam = exp(-pow(sin(a1) / w, 2.0)) * step(0.0, cos(a1)) + exp(-pow(sin(a2) / w, 2.0)) * step(0.0, cos(a2));
        beam *= exp(-tt * 0.12) * (0.6 + 0.4 * fbm(vec3(tt * 2.0 - u_time * 3.0, ang * 4.0, 1.0)));
        col += vec3(0.7, 0.75, 1.0) * beam * 0.9;
      }
    } else if (u_kind == 2 || u_kind == 3 || u_kind == 7) {
      col += u_col2 * exp(-tt * 18.0) * 0.5 * (u_kind == 7 ? 0.8 : 1.0);
      if (u_kind == 7) col += vec3(0.6, 0.15, 0.3) * exp(-tt * 3.0) * 0.35;
    }
    if (u_pulse > 0.0) {
      float r = 1.08 + 0.03 * sin(u_time * 4.0);
      col += vec3(1.0, 0.35, 0.35) * exp(-pow((d - r) / 0.012, 2.0)) * 0.7;
    }
    if (d >= 1.0) { gl_FragColor = vec4(col, 1.0); return; }
  }

  // --- on the disc: a lit sphere ---
  vec2 q = rel / u_radius;
  float z = sqrt(max(0.0, 1.0 - d * d));
  vec3 n = vec3(q, z);
  vec3 p = rotY(n, u_time * u_spin) + vec3(u_seed * 3.1);
  float mu = z;
  vec3 L = normalize(vec3(-0.55, 0.45, 0.7));
  float diff = max(dot(n, L), 0.0);
  float edge = smoothstep(0.0, 0.03, 1.0 - d); // antialiased limb

  if (u_kind == 6 || u_kind == 11 || u_kind == 5) {
    // photosphere: slowly evolving granulation cells, limb darkening, spots, faculae
    float gr = cells(p * 26.0 + vec3(0.0, 0.0, u_time * 0.05));
    float gr2 = cells(p * 60.0 + vec3(u_time * 0.08));
    float gran = smoothstep(0.1, 0.8, gr) * 0.7 + smoothstep(0.1, 0.8, gr2) * 0.3; // dark lanes between bright cells
    float big = fbm(p * 2.5 + vec3(u_time * 0.015));
    float limb = 1.0 - 0.55 * (1.0 - mu);
    float lum = (0.86 + 0.14 * (1.0 - gran)) * (0.92 + 0.16 * big);
    float spot = 0.0;
    if (u_kind == 6) spot = smoothstep(0.70, 0.74, fbm(p * 4.0 + vec3(7.0))) * (1.0 - smoothstep(0.1, 0.5, u_hot));
    lum *= 1.0 - 0.7 * spot;
    vec3 c = u_col * lum * limb;
    c += vec3(1.0) * pow(1.0 - d, 2.0) * 0.12 * u_hot;  // hot core brightening
    if (u_kind == 11) {
      float streak = pow(noise(vec3(ang * 10.0, d * 8.0 + u_time * 3.0, 2.0)), 3.0);
      c = mix(c, vec3(1.0, 0.35, 0.2), 0.5 + 0.4 * streak);
    }
    if (u_kind == 5) { // protostar: churning convective blobs, no granulation lanes
      float cl = fbm(p * 3.0 + vec3(0.0, u_time * 0.06, 0.0));
      float cl2 = fbm(p * 8.0 - vec3(u_time * 0.04));
      c = u_col * limb * (0.55 + 0.5 * cl + 0.25 * cl2 * cl2);
    }
    col = mix(col, c, edge);
  } else if (u_kind == 8 || u_kind == 9) {
    vec3 c = u_col * (1.25 - 0.45 * d * d) + vec3(1.0) * pow(1.0 - d, 1.5) * 0.4;
    if (u_kind == 9) c = mix(c, vec3(0.5, 0.55, 0.9), 0.3 * d);
    col = mix(col, c, edge);
  } else if (u_kind == 7 || u_kind == 2) {
    // banded atmosphere with turbulence
    float lat = p.y;
    float warp = fbm(p * 3.0 + vec3(0.0, u_time * 0.01, 0.0)) * 0.6;
    float band = sin(lat * 14.0 + warp * 4.0 + fbm(p * 7.0) * 1.5);
    float band2 = sin(lat * 31.0 + warp * 6.0) * 0.5;
    float m = 0.5 + 0.5 * band + 0.2 * band2;
    vec3 base = mix(u_col, u_col2, clamp(m, 0.0, 1.0));
    float storm = smoothstep(0.68, 0.74, fbm(p * 4.0 + vec3(11.0)));
    base = mix(base, u_col2 * 1.2, storm * 0.6);
    float swirl = fbm(p * 12.0 + vec3(u_time * 0.02)) * 0.25;
    base *= 0.85 + swirl;
    vec3 c;
    if (u_kind == 7) c = base * (0.35 + 0.65 * (0.12 + 0.88 * diff)) + vec3(0.55, 0.12, 0.25) * (0.4 - 0.2 * d);
    else c = base * (0.08 + 0.95 * diff) + u_col2 * pow(1.0 - mu, 3.0) * 0.25;
    col = mix(col, c, edge);
  } else {
    // rocky / icy surface: fbm terrain, craters, directional light
    float h = fbm(p * 4.0);
    float h2 = fbm(p * 11.0 + vec3(3.0));
    float cr = cells(p * 7.0 + vec3(1.0));
    float crater = smoothstep(0.08, 0.2, cr) * 0.5 + 0.5;
    float rim = smoothstep(0.18, 0.22, cr) - smoothstep(0.22, 0.3, cr);
    vec3 albedo = mix(u_col2, u_col, h) * (0.75 + 0.35 * h2) * crater + u_col * rim * 0.25;
    if (u_kind == 3) albedo = mix(albedo, vec3(0.9, 0.95, 1.0), 0.35 * smoothstep(0.5, 0.6, h));
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * (u_kind == 3 ? 0.35 : 0.05);
    vec3 c = albedo * (0.06 + 0.95 * diff) + spec;
    if (u_glow > 0.0) c += u_col * u_glow * 0.6; // self-luminous hot rock
    col = mix(col, c, edge);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
