// render.js — draws the object on a canvas. Sizes are on a log scale so a pebble and a
// supergiant both fit; the HUD states the real radius.
import { C } from './physics.js';

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Blackbody colour (Tanner Helland approximation), T in kelvin.
export function blackbody(T) {
  const t = Math.min(40000, Math.max(1000, T)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [c(r), c(g), c(b)];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const MATERIAL = {
  H: [232, 214, 178], He: [238, 228, 205], C: [46, 46, 52], O: [214, 228, 240], Ne: [205, 160, 200],
  Mg: [176, 162, 140], Si: [154, 132, 104], Fe: [118, 121, 130], n: [160, 150, 200],
};
export function materialColor(comp) {
  let c = [0, 0, 0], s = 0;
  for (const k in MATERIAL) { const x = comp[k] || 0; if (x > 0) { c = [c[0] + MATERIAL[k][0] * x, c[1] + MATERIAL[k][1] * x, c[2] + MATERIAL[k][2] * x]; s += x; } }
  return s > 0 ? c.map(v => v / s) : [150, 150, 150];
}

export class Renderer2D {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    const rnd = mulberry(1234);
    this.stars = Array.from({ length: 420 }, () => ({ x: rnd(), y: rnd(), s: 0.4 + rnd() * 1.3, b: 0.3 + rnd() * 0.7, c: rnd() }));
    this.rDisp = null; this.effects = []; this.tex = null; this.texKey = ''; this.phase = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    }
    this.w = w; this.h = h; this.dpr = dpr;
  }
  radiusPx(R) {
    const cap = 0.40 * Math.min(this.w, this.h);
    return Math.max(6, Math.min(cap, 8 + 14 * Math.log10(Math.max(R, 0.1) / 0.1)));
  }
  effect(type) { this.effects.push({ type, t0: performance.now() }); }

  texture(comp, kind) {
    const key = kind + Object.entries(comp).map(([k, v]) => k + (v || 0).toFixed(2)).join('');
    if (key === this.texKey) return this.tex;
    const size = 256, off = document.createElement('canvas'); off.width = off.height = size;
    const g = off.getContext('2d');
    const base = materialColor(comp);
    const rnd = mulberry(99);
    g.fillStyle = rgb(base); g.fillRect(0, 0, size, size);
    const gas = (comp.H || 0) + (comp.He || 0) > 0.5;
    if (gas) { // bands
      let y = 0;
      while (y < size) {
        const hgt = 6 + rnd() * 26;
        const tone = mix(base, rnd() < 0.5 ? [120, 78, 40] : [250, 240, 220], 0.15 + rnd() * 0.35);
        g.fillStyle = rgb(tone, 0.8); g.fillRect(0, y, size, hgt);
        y += hgt;
      }
    } else { // blotches and craters
      for (let i = 0; i < 70; i++) {
        const r = 4 + rnd() * 30, x = rnd() * size, y = rnd() * size;
        const tone = mix(base, rnd() < 0.5 ? [0, 0, 0] : [255, 255, 255], 0.08 + rnd() * 0.25);
        g.fillStyle = rgb(tone, 0.6); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
    this.tex = off; this.texKey = key; return off;
  }

  draw(a, now) {
    this.resize();
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a0d17'); bg.addColorStop(1, '#06070c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 10;
    const kind = a.classification ? a.classification.kind : 'gone';
    const isBH = a.phase === 'blackhole';
    const target = a.phase === 'gone' ? 0 : this.radiusPx(a.R);
    if (this.rDisp === null) this.rDisp = target;
    const k = this.reduced ? 1 : (target < this.rDisp ? 0.18 : 0.12);
    this.rDisp += (target - this.rDisp) * k;
    const r = this.rDisp;
    this.phase += 0.016;

    // stars (lensed by a black hole)
    for (const s of this.stars) {
      let x = s.x * w, y = s.y * h;
      if (isBH) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        const rE = r * 1.6;
        if (d < r * 1.05) continue;
        const d2 = d + rE * rE / Math.max(d, 1) * 0.9;
        x = cx + dx / d * d2; y = cy + dy / d * d2;
        if (x < 0 || x > w || y < 0 || y > h) continue;
      }
      const tw = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(this.phase * 3 + s.c * 40);
      ctx.fillStyle = `rgba(${200 + 55 * s.c},${210},${230 + 25 * (1 - s.c)},${s.b * tw})`;
      ctx.beginPath(); ctx.arc(x, y, s.s, 0, Math.PI * 2); ctx.fill();
    }

    if (a.phase === 'gone') { this.drawEffects(ctx, cx, cy, now, r); return; }
    if (isBH) { this.drawBlackHole(ctx, cx, cy, r); this.drawEffects(ctx, cx, cy, now, r); return; }

    const comp = a.mix || a.comp;
    switch (kind) {
      case 'cloud': this.drawCloud(ctx, cx, cy, r, comp); break;
      case 'star': case 'proto': case 'collapse': this.drawStar(ctx, cx, cy, r, a, kind); break;
      case 'brown': this.drawBrown(ctx, cx, cy, r, a); break;
      case 'wd': this.drawWD(ctx, cx, cy, r, a); break;
      case 'neutron': this.drawNeutron(ctx, cx, cy, r, a); break;
      default: this.drawBody(ctx, cx, cy, r, a, comp);
    }
    this.drawEffects(ctx, cx, cy, now, r);
  }

  shade(ctx, cx, cy, r, strength = 1) {
    const g = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.45, r * 0.1, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${0.18 * strength})`);
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${0.75 * strength})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  glow(ctx, cx, cy, r, color, extent, alpha) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * extent);
    g.addColorStop(0, rgb(color, alpha)); g.addColorStop(0.4, rgb(color, alpha * 0.25)); g.addColorStop(1, rgb(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * extent, 0, Math.PI * 2); ctx.fill();
  }
  drawBody(ctx, cx, cy, r, a, comp) {
    const tex = this.texture(comp, 'body');
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(tex, cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
    if (a.Teff > 600) this.glow(ctx, cx, cy, r, blackbody(a.Teff), 1.5, Math.min(0.5, (a.Teff - 600) / 3000));
    this.shade(ctx, cx, cy, r, 1);
    if (a.overPressured && !this.reduced) {
      ctx.strokeStyle = 'rgba(255,107,107,0.6)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r + 6 + 3 * Math.sin(this.phase * 4), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  drawCloud(ctx, cx, cy, r, comp) {
    const rr = r * 1.5, base = [120, 140, 175];
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, rgb(base, 0.55)); g.addColorStop(0.5, rgb(base, 0.25)); g.addColorStop(1, rgb(base, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
    const rnd = mulberry(7);
    for (let i = 0; i < 18; i++) {
      const ang = rnd() * Math.PI * 2, d = rnd() * rr * 0.8, s = rr * (0.15 + rnd() * 0.3);
      const gg = ctx.createRadialGradient(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 0, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, s);
      gg.addColorStop(0, rgb(base, 0.18)); gg.addColorStop(1, rgb(base, 0));
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, s, 0, Math.PI * 2); ctx.fill();
    }
  }
  drawStar(ctx, cx, cy, r, a, kind) {
    const T = Math.max(1000, a.Teff);
    const col = kind === 'collapse' ? [255, 90, 60] : blackbody(T);
    const bright = Math.min(1, 0.35 + 0.15 * Math.log10(Math.max(a.Lrad / C.Lsun, 1e-6) + 1e-6) / 2 + 0.5);
    const flick = this.reduced ? 1 : 1 + 0.02 * Math.sin(this.phase * 7) + 0.01 * Math.sin(this.phase * 13);
    const corona = T < 7500 ? mix(col, [255, 160, 60], 0.45) : col;
    this.glow(ctx, cx, cy, r, corona, kind === 'proto' ? 1.4 : 2.2 * flick, kind === 'proto' ? 0.35 : 0.55 * bright);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgb(mix(col, [255, 255, 255], 0.75)));
    g.addColorStop(0.6, rgb(col));
    g.addColorStop(1, rgb(mix(col, [0, 0, 0], 0.45)));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // granulation
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const rnd = mulberry(Math.floor(this.phase * (this.reduced ? 0 : 2)) + 3);
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < 140; i++) {
      const ang = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r, s = r * (0.015 + rnd() * 0.04);
      ctx.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
      ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    if (kind === 'collapse' && !this.reduced) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const ang = i / 12 * Math.PI * 2 + this.phase * 0.5, p = (this.phase * 2) % 1;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r * (1.6 - 0.5 * p), cy + Math.sin(ang) * r * (1.6 - 0.5 * p));
        ctx.lineTo(cx + Math.cos(ang) * r * (1.3 - 0.5 * p), cy + Math.sin(ang) * r * (1.3 - 0.5 * p)); ctx.stroke();
      }
    }
  }
  drawBrown(ctx, cx, cy, r, a) {
    const col = [150, 40, 70];
    this.glow(ctx, cx, cy, r, [200, 60, 90], 1.5, 0.3);
    const tex = this.texture({ H: 0.7, He: 0.3 }, 'brown');
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = rgb(col); ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.globalAlpha = 0.35; ctx.drawImage(tex, cx - r, cy - r, 2 * r, 2 * r); ctx.globalAlpha = 1;
    ctx.restore();
    this.shade(ctx, cx, cy, r, 0.8);
  }
  drawWD(ctx, cx, cy, r, a) {
    const col = a.Teff > 3000 ? blackbody(Math.max(4000, a.Teff)) : [120, 130, 150];
    if (a.Teff > 3000) this.glow(ctx, cx, cy, r, col, 2.6, 0.55);
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, rgb(col)); g.addColorStop(1, rgb(mix(col, [0, 0, 0], 0.5)));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  drawNeutron(ctx, cx, cy, r, a) {
    const col = [200, 220, 255];
    this.glow(ctx, cx, cy, r, [150, 160, 255], 3, 0.5);
    if (!this.reduced) {
      const ang = this.phase * 2.5;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      for (const s of [1, -1]) {
        const g = ctx.createLinearGradient(0, 0, 0, s * r * 9);
        g.addColorStop(0, 'rgba(190,200,255,0.55)'); g.addColorStop(1, 'rgba(190,200,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-r * 0.5, 0); ctx.lineTo(-r * 1.6, s * r * 9); ctx.lineTo(r * 1.6, s * r * 9); ctx.lineTo(r * 0.5, 0); ctx.fill();
      }
      ctx.restore();
    }
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, rgb(col)); g.addColorStop(1, 'rgba(90,100,160,1)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  drawBlackHole(ctx, cx, cy, r) {
    const g = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 2.4);
    g.addColorStop(0, 'rgba(255,200,120,0.25)'); g.addColorStop(0.3, 'rgba(120,140,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,225,170,0.95)'; ctx.lineWidth = Math.max(1.5, r * 0.04);
    ctx.shadowColor = 'rgba(255,200,120,0.9)'; ctx.shadowBlur = r * 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  drawEffects(ctx, cx, cy, now, r) {
    this.effects = this.effects.filter(e => now - e.t0 < 2600);
    for (const e of this.effects) {
      const t = (now - e.t0) / 2600;
      if (e.type === 'boom') {
        ctx.fillStyle = `rgba(255,245,220,${Math.max(0, 0.9 - t * 3)})`; ctx.fillRect(0, 0, this.w, this.h);
        const rr = 20 + t * Math.min(this.w, this.h) * 0.7;
        ctx.strokeStyle = `rgba(255,170,90,${1 - t})`; ctx.lineWidth = 12 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        const rnd = mulberry(5);
        for (let i = 0; i < 80; i++) {
          const ang = rnd() * Math.PI * 2, sp = 0.4 + rnd() * 0.6, d = rr * sp;
          ctx.fillStyle = `rgba(255,${150 + 80 * rnd()},${80},${(1 - t) * 0.9})`;
          ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 1 + rnd() * 2.5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (e.type === 'nebula') {
        const rr = r + t * Math.min(this.w, this.h) * 0.45;
        const g = ctx.createRadialGradient(cx, cy, rr * 0.6, cx, cy, rr);
        g.addColorStop(0, `rgba(80,200,190,${0.0})`); g.addColorStop(0.7, `rgba(90,210,180,${0.35 * (1 - t)})`); g.addColorStop(1, `rgba(220,120,160,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
      } else if (e.type === 'disperse') {
        const rnd = mulberry(11);
        for (let i = 0; i < 120; i++) {
          const ang = rnd() * Math.PI * 2, d = (r + 10) * (0.2 + rnd()) + t * 220 * (0.3 + rnd());
          ctx.fillStyle = `rgba(150,170,210,${(1 - t) * 0.6})`;
          ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 1 + rnd() * 2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (e.type === 'collapse') {
        ctx.strokeStyle = `rgba(180,140,255,${1 - t})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, r + (1 - t) * 90, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}
