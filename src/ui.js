// ui.js — readouts, the regime map and the composition controls.
import { C, USER_KEYS, SPECIES, PRESETS, M_TOV, T_FLOOR, compStats, normalizeComp, pFermiElectron, nuclearRates } from './physics.js';
import { sci, fmtMass, fmtMassLong, fmtLen, fmtLenCompare, fmtTime, fmtTemp, fmtLum, pct } from './format.js';

const $ = (id) => document.getElementById(id);

export function kv(el, rows) {
  const frag = document.createDocumentFragment();
  for (const [k, v, sub] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (sub) { const s = document.createElement('small'); s.textContent = ' ' + sub; dd.appendChild(s); }
    frag.append(dt, dd);
  }
  el.replaceChildren(frag);
}

export function updateReadouts(a) {
  const struct = $('struct'), energy = $('energy'), rx = $('reactions'), bar = $('support-bar'), legend = $('support-legend');
  if (a.phase === 'blackhole') {
    const b = a.bh;
    kv(struct, [
      ['Mass', fmtMassLong(a.M)],
      ['Horizon radius (Schwarzschild)', fmtLen(b.Rs)],
      ['Photon sphere', fmtLen(1.5 * b.Rs)],
      ['Innermost stable orbit', fmtLen(3 * b.Rs)],
      ['Mean density inside horizon', `${sci(b.rhoMean)} kg/m³`],
      ['Tidal stretch at horizon', `${sci(2 * C.G * a.M / b.Rs ** 3)} s⁻²`, 'per metre'],
      ['Ejected on the way', a.ejected > 0 ? fmtMass(a.ejected) : '—'],
    ]);
    bar.replaceChildren(); legend.textContent = 'No pressure of any kind. Spacetime itself does the holding.';
    kv(energy, [
      ['Hawking temperature', fmtTemp(b.TH)],
      ['Hawking luminosity', `${sci(4 * Math.PI * b.Rs ** 2 * C.sigma * b.TH ** 4)} W`],
      ['Evaporation time', fmtTime(b.tEvap)],
    ]);
    rx.replaceChildren();
    return;
  }
  if (a.phase === 'gone') {
    kv(struct, [['Mass left', '0'], ['Ejected', fmtMass(a.ejected)]]);
    bar.replaceChildren(); legend.textContent = '';
    kv(energy, []); rx.replaceChildren();
    return;
  }
  const s = a.s;
  kv(struct, [
    ['Mass', fmtMassLong(a.M)],
    ['Radius', fmtLen(a.R), fmtLenCompare(a.R)],
    ['Mean density', `${sci(a.rhoMean)} kg/m³`],
    ['Central density', `${sci(s.rhoC)} kg/m³`],
    ['Central temperature', fmtTemp(a.T)],
    ['Central pressure', `${sci(s.Pc)} Pa`],
    ['Surface gravity', `${sci(a.g)} m/s²`, `${sci(a.g / 9.80665)} g`],
    ['Escape velocity', a.vesc > 3e6 ? `${(100 * a.vesc / C.c).toPrecision(2)}% of c` : `${sci(a.vesc / 1e3)} km/s`],
    ['Schwarzschild radius', fmtLen(a.Rs), `${sci(a.compactness)} of R`],
    ['Polytropic index', s.n.toFixed(2), `ρc/ρ̄ = ${s.poly.D.toFixed(1)}`],
    ['Burning core', pct(a.fcore), 'of mass'],
  ]);
  const seg = [
    ['c-e', a.support.electron, 'Degenerate electrons'], ['c-n', a.support.neutron, 'Degenerate neutrons'],
    ['c-i', a.support.ion, 'Ion gas'], ['c-t', a.support.eth, 'Thermal electrons'], ['c-r', a.support.rad, 'Radiation'],
  ];
  bar.replaceChildren(...seg.map(([c, f]) => { const sp = document.createElement('span'); sp.className = c; sp.style.width = `${100 * f}%`; return sp; }));
  legend.replaceChildren(...seg.filter(x => x[1] > 0.002).map(([c, f, n]) => { const d = document.createElement('span'); const i = document.createElement('i'); i.className = c; d.append(i, `${n} ${pct(f)}`); return d; }));
  const edd = a.Lrad / a.LEdd;
  kv(energy, [
    ['Luminosity', fmtLum(a.Lrad), a.Lrad > 1e-30 ? `${sci(a.Lrad)} W` : ''],
    ['Surface temperature', fmtTemp(a.Teff)],
    ['Fusion power', a.Lnuc > 0 ? fmtLum(a.Lnuc) : '—'],
    ['Neutrino losses', a.Lnu > 1e-30 ? fmtLum(a.Lnu) : '—'],
    ['Photodisintegration', a.Lphoto > 1e-30 ? fmtLum(a.Lphoto) : '—'],
    ['Eddington ratio', edd > 1e-6 ? sci(edd) : '—', edd > 1 ? 'super-Eddington: would shed mass' : ''],
    ['Free-fall time', fmtTime(a.tff)],
    ['Thermal timescale', a.isStatic ? '∞' : fmtTime(a.tKH), 'Kelvin–Helmholtz'],
    ['Fuel remaining', a.dominant ? fmtTime(a.tNuc) : '—', a.dominant ? a.dominant.fuel + ' burning' : ''],
  ]);
  const maxL = Math.max(...a.reactions.map(r => r.L), 1e-30);
  rx.replaceChildren(...a.reactions.map(r => {
    const d = document.createElement('div'); d.className = 'rx' + (r.L > 1e-3 * maxL && r.L > 1e-30 ? ' on' : '');
    const n = document.createElement('span'); n.className = 'name'; n.textContent = r.label;
    const v = document.createElement('span'); v.className = 'val'; v.textContent = r.L > 1e-30 ? fmtLum(r.L) : '—';
    const m = document.createElement('div'); m.className = 'meter'; const i = document.createElement('i');
    const frac = r.L > 1e-30 ? Math.max(0, 1 + Math.log10(r.L / maxL) / 6) : 0;
    i.style.width = `${100 * frac}%`; m.appendChild(i);
    d.append(n, v, m); return d;
  }));
}

export function statusLine(a) {
  if (a.phase === 'blackhole') return 'Final. Only its mass can still change.';
  if (a.phase === 'gone') return 'Nothing remains. Start a new object.';
  if (a.overPressured) return `Not in equilibrium: pressure beats gravity. It will rebound in ~${fmtTime(a.tff)}.`;
  if (a.isStatic) return 'Static. Nothing more will happen on any timescale.';
  if (a.T > 3e9 && a.Lnuc < a.Lnu + a.Lphoto) return `Collapsing. Free-fall time ${fmtTime(a.tff)}.`;
  if (a.tKH < a.tff && a.Lnuc < a.Lrad && a.T < 1e6) return `Transparent to its own radiation: falling inward in free fall (${fmtTime(a.tff)}).`;
  if (a.Lnuc > 0.8 * a.Lrad && a.Lnuc < 1.25 * (a.Lrad + a.Lnu)) return `In thermal equilibrium: fusion matches losses. Fuel lasts ~${fmtTime(a.tNuc)}.`;
  if (a.Lnuc > 1.25 * (a.Lrad + a.Lnu)) return `Fusion outruns losses: heating and expanding (thermostat).`;
  return `Radiating ${fmtLum(a.Lrad + a.Lnu)} with no fusion to replace it: contracting on ${fmtTime(a.tKH)}.`;
}

// ---------- composition controls ----------
export function buildComposition(onChange) {
  const list = $('comp-list'), sel = $('preset');
  const inputs = {};
  for (const sp of SPECIES) {
    if (sp.hidden) continue;
    const lab = document.createElement('label'); lab.textContent = sp.key; lab.htmlFor = 'comp-' + sp.key; lab.title = sp.name;
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = 0; inp.max = 100; inp.step = 0.5; inp.id = 'comp-' + sp.key;
    const out = document.createElement('output'); out.htmlFor = inp.id;
    inputs[sp.key] = { inp, out };
    inp.addEventListener('input', () => { onChange(readComposition(inputs)); sel.value = 'custom'; });
    list.append(lab, inp, out);
  }
  for (const [k, p] of Object.entries(PRESETS)) { const o = document.createElement('option'); o.value = k; o.textContent = p.label; sel.appendChild(o); }
  const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'Custom mix'; sel.appendChild(o);
  sel.value = 'solar';
  sel.addEventListener('change', () => { if (PRESETS[sel.value]) { showComposition(inputs, normalizeComp(PRESETS[sel.value].comp)); onChange(readComposition(inputs)); } });
  return inputs;
}
export function readComposition(inputs) {
  const c = {};
  for (const k in inputs) c[k] = +inputs[k].inp.value;
  return c;
}
export function showComposition(inputs, comp) {
  for (const k in inputs) {
    const v = 100 * (comp[k] || 0);
    inputs[k].inp.value = v.toFixed(1);
    inputs[k].out.textContent = v < 0.05 && v > 0 ? '<0.1%' : `${v.toFixed(v < 10 ? 1 : 0)}%`;
  }
}

// ---------- regime map ----------
const RX_REF = normalizeComp({ H: 0.7, He: 0.28, C: 0.006, O: 0.014 });
const RX_LINES = [
  ['pD', 'D', normalizeComp({ H: 1 })], ['pp', 'H', RX_REF], ['3a', 'He', normalizeComp({ He: 1 })],
  ['CC', 'C', normalizeComp({ C: 1 })], ['OO', 'O', normalizeComp({ O: 1 })], ['Si', 'Si', normalizeComp({ Si: 1 })],
];
let regimeBase = null;
function ignitionT(key, comp, rho) {
  // temperature where the reaction yields 1e-4 W/kg (ignition for practical purposes)
  let lo = 4, hi = 11;
  for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); const r = nuclearRates(rho, Math.pow(10, mid), comp); if ((r[key] || 0) < 1e-4) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}
export function drawRegime(canvas, a, trail) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const x0 = 34, x1 = W - 8, y0 = 8, y1 = H - 24;
  const LR = [-6, 20], LT = [1, 12];
  const X = (lr) => x0 + (lr - LR[0]) / (LR[1] - LR[0]) * (x1 - x0);
  const Y = (lt) => y1 - (lt - LT[0]) / (LT[1] - LT[0]) * (y1 - y0);
  if (!regimeBase) {
    const off = document.createElement('canvas'); off.width = W; off.height = H; const g = off.getContext('2d');
    g.fillStyle = '#0c0f18'; g.fillRect(0, 0, W, H);
    const csH = compStats(RX_REF);
    // degenerate region: electron Fermi pressure exceeds ideal electron pressure
    g.beginPath(); g.moveTo(X(LR[0]), Y(LT[0]));
    for (let lr = LR[0]; lr <= LR[1]; lr += 0.25) {
      const rho = Math.pow(10, lr), ne = rho / (csH.muE * C.mu);
      const Tdeg = pFermiElectron(ne) / (ne * C.k);
      g.lineTo(X(lr), Y(Math.min(LT[1], Math.max(LT[0], Math.log10(Tdeg)))));
    }
    g.lineTo(X(LR[1]), Y(LT[0])); g.closePath(); g.fillStyle = 'rgba(111,211,255,0.10)'; g.fill();
    // radiation-dominated region
    g.beginPath(); g.moveTo(X(LR[0]), Y(LT[1]));
    for (let lr = LR[0]; lr <= LR[1]; lr += 0.5) {
      const rho = Math.pow(10, lr);
      const Trad = Math.cbrt(3 * rho * C.k / (C.a * csH.mu * C.mu));
      g.lineTo(X(lr), Y(Math.min(LT[1], Math.log10(Trad))));
    }
    g.lineTo(X(LR[1]), Y(LT[1])); g.closePath(); g.fillStyle = 'rgba(255,241,184,0.08)'; g.fill();
    // ignition lines
    g.font = '10px IBM Plex Mono, monospace'; g.textBaseline = 'bottom';
    for (const [key, label, comp] of RX_LINES) {
      g.beginPath();
      let first = true;
      for (let lr = -2; lr <= 14; lr += 1) {
        const lt = ignitionT(key, comp, Math.pow(10, lr));
        if (first) { g.moveTo(X(lr), Y(lt)); first = false; } else g.lineTo(X(lr), Y(lt));
      }
      g.strokeStyle = 'rgba(255,179,71,0.45)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,179,71,0.8)'; g.fillText(label, X(14) + 3, Y(ignitionT(key, comp, 1e14)) + 4);
    }
    g.fillStyle = 'rgba(111,211,255,0.8)'; g.fillText('degenerate', X(8), Y(3.2));
    g.fillStyle = 'rgba(255,241,184,0.8)'; g.fillText('radiation', X(-5), Y(8.3));
    // axes
    g.strokeStyle = '#222838'; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#8d93a6'; g.textBaseline = 'top'; g.textAlign = 'center';
    for (let lr = -5; lr <= 20; lr += 5) g.fillText(String(lr), X(lr), y1 + 3);
    g.fillText('log₁₀ ρc (kg/m³)', (x0 + x1) / 2, y1 + 12);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let lt = 2; lt <= 12; lt += 2) g.fillText(String(lt), x0 - 4, Y(lt));
    g.save(); g.translate(8, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('log₁₀ Tc (K)', 0, 0); g.restore();
    regimeBase = off;
  }
  ctx.drawImage(regimeBase, 0, 0);
  if (a.phase !== 'object') return;
  // black-hole density for this mass
  const Rs = a.Rs, rhoBH = a.s.poly.D * a.M / (4 / 3 * Math.PI * (1.41 * Rs) ** 3);
  const xb = X(Math.log10(rhoBH));
  if (xb > x0 && xb < x1) {
    ctx.fillStyle = 'rgba(255,107,107,0.12)'; ctx.fillRect(xb, y0, x1 - xb, y1 - y0);
    ctx.strokeStyle = 'rgba(255,107,107,0.7)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xb, y0); ctx.lineTo(xb, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,107,107,0.9)'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('black hole', xb - 3, y0 + 3);
  }
  if (trail.length > 1) {
    ctx.strokeStyle = 'rgba(231,228,218,0.5)'; ctx.lineWidth = 1.2; ctx.beginPath();
    trail.forEach(([lr, lt], i) => { const x = X(lr), y = Y(lt); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
  }
  const px = X(Math.log10(a.s.rhoC)), py = Y(Math.log10(a.T));
  ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#07090f'; ctx.lineWidth = 1; ctx.stroke();
}

export function renderLog(events) {
  const ol = $('log');
  ol.replaceChildren(...events.map(e => {
    const li = document.createElement('li');
    const t = document.createElement('span'); t.className = 't'; t.textContent = fmtTime(e.t);
    const x = document.createElement('span'); x.className = e.kind; x.textContent = e.text;
    li.append(t, x); return li;
  }));
}
