// render.js — WebGL renderer for the object (shader in shader.js) with a 2D overlay for
// one-off effects. Falls back to the 2D renderer if WebGL is unavailable.
import { C } from './physics.js';
import { VERT, FRAG } from './shader.js';
import { Renderer2D, blackbody, materialColor } from './render2d.js';

const KIND = { rock: 1, planet: 1, unstable: 1, cloud: 4, proto: 5, star: 6, brown: 7, wd: 8, neutron: 9, blackhole: 10, collapse: 11, gone: 0 };

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) { this.fallback = new Renderer2D(canvas); return; }
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); this.fallback = new Renderer2D(canvas); return; }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const name of ['u_res', 'u_time', 'u_center', 'u_radius', 'u_kind', 'u_col', 'u_col2', 'u_glow', 'u_seed', 'u_spin', 'u_hot', 'u_pulse']) this.u[name] = gl.getUniformLocation(prog, name);
    // overlay canvas for effects
    this.ov = document.createElement('canvas');
    this.ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    canvas.parentNode.insertBefore(this.ov, canvas.nextSibling);
    this.octx = this.ov.getContext('2d');
    this.fx = new Renderer2D(this.ov); // reuse its effect drawing
    this.rDisp = null; this.effects = []; this.seed = 0.37;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t0 = performance.now();
  }
  effect(type) { if (this.fallback) return this.fallback.effect(type); this.effects.push({ type, t0: performance.now() }); }
  set effectsList(v) { this.effects = v; }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    for (const c of [this.cv, this.ov]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    }
    this.w = w; this.h = h; this.dpr = dpr;
  }
  radiusPx(R) {
    const cap = 0.40 * Math.min(this.w, this.h);
    return Math.max(6, Math.min(cap, 8 + 14 * Math.log10(Math.max(R, 0.1) / 0.1)));
  }
  draw(a, now) {
    if (this.fallback) return this.fallback.draw(a, now);
    this.resize();
    const gl = this.gl, dpr = this.dpr;
    const kind = a.classification ? a.classification.kind : 'gone';
    const isBH = a.phase === 'blackhole';
    const target = a.phase === 'gone' ? 0 : this.radiusPx(a.R);
    if (this.rDisp === null) this.rDisp = target;
    const k = this.reduced ? 1 : (target < this.rDisp ? 0.18 : 0.12);
    this.rDisp += (target - this.rDisp) * k;
    const r = this.rDisp;
    const time = this.reduced ? 0 : (now - this.t0) / 1000;

    // appearance parameters
    const comp = a.mix || a.comp || {};
    let col = [0.8, 0.8, 0.8], col2 = [0.4, 0.4, 0.4], glow = 0, spin = 0.05, hot = 0, kid = KIND[kind] ?? 1;
    const bb = (T) => blackbody(T).map(v => v / 255);
    const gasRich = (comp.H || 0) + (comp.He || 0) > 0.5;
    if (a.phase === 'gone') kid = 0;
    else if (isBH) kid = 10;
    else if (kind === 'star' || kind === 'collapse' || kind === 'proto') {
      const T = Math.max(1200, a.Teff);
      col = bb(T); const lg = Math.log10(Math.max(a.Lrad / C.Lsun, 1e-8));
      if (T < 7500) col = col.map((v, i) => v * (1 - 0.18) + [1.0, 0.8, 0.45][i] * 0.18); // warm tint for sunlike stars
      glow = kind === 'proto' ? 0.5 : Math.min(1.6, 0.6 + 0.12 * (lg + 4));
      hot = Math.min(1, Math.max(0, (T - 4000) / 12000));
      spin = kind === 'proto' ? 0.03 : 0.06;
      if (kind === 'collapse') { col = [1.0, 0.45, 0.3]; glow = 1.2; }
    } else if (kind === 'wd' || kind === 'neutron') {
      const T = kind === 'neutron' ? 25000 : Math.max(4500, a.Teff);
      col = a.Teff > 2500 || kind === 'neutron' ? bb(T) : [0.45, 0.48, 0.55];
      glow = a.Teff > 2500 ? 1.0 : (kind === 'neutron' ? 0.8 : 0.05);
      spin = kind === 'neutron' ? 2.2 : 0.1;
    } else if (kind === 'brown') {
      col = [0.55, 0.12, 0.25]; col2 = [0.25, 0.05, 0.14]; glow = 0; spin = 0.12; kid = 7;
    } else if (kind === 'cloud') {
      kid = 4;
    } else { // rock / planet / unstable
      const mc = materialColor(comp).map(v => v / 255);
      if (gasRich) { kid = 2; col = [0.93, 0.86, 0.72]; col2 = [0.62, 0.42, 0.25]; spin = 0.15; }
      else if ((comp.O || 0) > 0.6 && (comp.H || 0) > 0.05) { kid = 3; col = [0.85, 0.9, 0.97]; col2 = [0.55, 0.65, 0.8]; spin = 0.08; }
      else { kid = 1; col = mc; col2 = mc.map(v => v * 0.45); spin = 0.08; }
      if (a.Teff > 700) { glow = Math.min(0.8, (a.Teff - 700) / 2500); col = bb(Math.max(1200, a.Teff)); }
    }
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.uniform2f(this.u.u_res, this.cv.width, this.cv.height);
    gl.uniform1f(this.u.u_time, time);
    gl.uniform2f(this.u.u_center, this.w / 2 * dpr, (this.h / 2 - 10) * dpr);
    gl.uniform1f(this.u.u_radius, Math.max(r, 0.5) * dpr);
    gl.uniform1i(this.u.u_kind, kid);
    gl.uniform3f(this.u.u_col, col[0], col[1], col[2]);
    gl.uniform3f(this.u.u_col2, col2[0], col2[1], col2[2]);
    gl.uniform1f(this.u.u_glow, glow);
    gl.uniform1f(this.u.u_seed, this.seed);
    gl.uniform1f(this.u.u_spin, spin);
    gl.uniform1f(this.u.u_hot, hot);
    gl.uniform1f(this.u.u_pulse, a.overPressured ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // effects overlay
    const ctx = this.octx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.fx.w = this.w; this.fx.h = this.h; this.fx.effects = this.effects;
    this.fx.drawEffects(ctx, this.w / 2, this.h / 2 + 10, now, r);
    this.effects = this.fx.effects;
  }
}
