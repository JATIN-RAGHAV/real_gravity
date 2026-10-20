// main.js — wires controls, simulation, renderer and readouts together.
import { C, PRESETS, normalizeComp } from './physics.js';
import { createState, setMass, setDensity, setComp, analyze, step, meanDensity } from './sim.js';
import { Renderer } from './render.js';
import { updateReadouts, statusLine, buildComposition, readComposition, showComposition, drawRegime, renderLog } from './ui.js';
import { sci, fmtMass, fmtLen, fmtLenCompare, fmtTime } from './format.js';

const $ = (id) => document.getElementById(id);
const massEl = $('mass'), rhoEl = $('rho'), playEl = $('play');
const renderer = new Renderer($('stage'));

let st, running = true, speed = 1, holding = false, lastReadout = 0, toastTimer = 0;
const comps = buildComposition((weights) => { if (!ensureObject()) setComp(st, weights); });

function ensureObject() {
  if (st.phase === 'gone') { newObject(); return true; }
  return false;
}
function newObject(M = Math.pow(10, +massEl.value), rho = Math.pow(10, +rhoEl.value), comp = readComposition(comps)) {
  st = createState(M, rho, comp);
  renderer.effects = []; renderer.rDisp = null;
  massEl.value = Math.log10(M).toFixed(3); rhoEl.value = Math.log10(rho).toFixed(3);
  showComposition(comps, st.comp);
  syncLocks();
}

function syncLocks() {
  const bh = st.phase === 'blackhole', gone = st.phase === 'gone';
  rhoEl.disabled = bh;
  $('comp-list').classList.toggle('locked', bh);
  $('comp-note').textContent = bh ? 'Composition is lost behind the horizon (a black hole has no hair).'
    : gone ? 'Move any control to start a new object.'
    : st.envelope ? 'Burning core. The envelope keeps the mix you chose.' : 'Mass fractions. Once fusion starts, these show the burning core.';
}

function syncControls(a) {
  if (holding) return;
  massEl.value = Math.log10(st.M).toFixed(3);
  $('mass-out').textContent = fmtMass(st.M);
  if (a.phase === 'object') {
    const rho = meanDensity(st);
    rhoEl.value = Math.log10(rho).toFixed(3);
    $('rho-out').textContent = `${sci(rho)} kg/m³`;
    $('radius-out').textContent = `radius ${fmtLen(st.R)} ${fmtLenCompare(st.R) ? '· ' + fmtLenCompare(st.R) : ''}`;
    showComposition(comps, st.comp);
  } else if (a.phase === 'blackhole') {
    $('rho-out').textContent = '—';
    $('radius-out').textContent = `horizon ${fmtLen(a.R)}`;
  } else {
    $('rho-out').textContent = '—'; $('radius-out').textContent = '';
  }
}

function showToast(ev) {
  const t = $('toast');
  t.textContent = ev.text; t.className = 'toast ' + ev.kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  if (ev.kind === 'boom') renderer.effect(ev.text.startsWith('Planetary') ? 'nebula' : ev.text.includes('disperses') ? 'disperse' : 'boom');
  else if (ev.kind === 'collapse') renderer.effect('collapse');
}

function frame(now) {
  if (running && !holding && st.phase === 'object') {
    const n = speed;
    for (let i = 0; i < n; i++) {
      step(st);
      if (st.pending) { const ev = st.pending; st.pending = null; showToast(ev); if (ev.kind !== 'info') break; }
      if (st.phase !== 'object') break;
    }
    if (st.pending) { showToast(st.pending); st.pending = null; }
  }
  const a = analyze(st);
  renderer.draw(a, now);
  if (now - lastReadout > 120) {
    lastReadout = now;
    updateReadouts(a);
    syncControls(a);
    syncLocks();
    const cl = a.classification;
    $('badge-kind').textContent = cl.kind; $('badge-kind').dataset.kind = cl.kind;
    $('class-name').textContent = cl.name; $('class-summary').textContent = cl.summary;
    $('status-line').textContent = statusLine(a);
    $('scale-note').textContent = a.phase === 'gone' ? '' : `drawn on a log scale · ${a.phase === 'blackhole' ? 'horizon' : 'radius'} ${fmtLen(a.R)}`;
    $('clock').textContent = fmtTime(st.time);
    $('clock-step').textContent = st.phase === 'object' && running ? (a.isStatic ? 'static' : `${fmtTime(st.lastDt * speed)} per frame`) : (st.phase !== 'object' ? 'final' : 'paused');
    drawRegime($('regime'), a, st.trail);
    renderLog(st.events);
    playEl.textContent = running ? 'Pause' : 'Run';
    playEl.classList.toggle('paused', !running);
  }
  requestAnimationFrame(frame);
}

// ---------- controls ----------
function hold(el) {
  el.addEventListener('pointerdown', () => { holding = true; });
  const release = () => { holding = false; };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
  window.addEventListener('pointerup', release);
  el.addEventListener('keydown', () => { holding = true; clearTimeout(el._k); el._k = setTimeout(release, 600); });
}
hold(massEl); hold(rhoEl);
massEl.addEventListener('input', () => {
  if (st.phase === 'gone') { newObject(); return; }
  setMass(st, Math.pow(10, +massEl.value));
  $('mass-out').textContent = fmtMass(st.M);
});
rhoEl.addEventListener('input', () => {
  if (st.phase === 'gone') { newObject(); return; }
  setDensity(st, Math.pow(10, +rhoEl.value));
  $('rho-out').textContent = `${sci(Math.pow(10, +rhoEl.value))} kg/m³`;
});
$('mass-chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (st.phase === 'gone') newObject();
  setMass(st, +b.dataset.v); massEl.value = Math.log10(+b.dataset.v).toFixed(3);
});
$('rho-chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (st.phase === 'gone') newObject();
  setDensity(st, +b.dataset.v); rhoEl.value = Math.log10(+b.dataset.v).toFixed(3);
});
playEl.addEventListener('click', () => { running = !running; playEl.textContent = running ? 'Pause' : 'Run'; });
document.querySelectorAll('.speed button').forEach(b => b.addEventListener('click', () => {
  speed = +b.dataset.s;
  document.querySelectorAll('.speed button').forEach(x => x.classList.toggle('on', x === b));
}));
$('reset').addEventListener('click', () => { newObject(); running = true; });

const SCENARIOS = [
  ['Sun from a cold cloud', 1 * C.Msun, 1e-15, 'solar'],
  ['A brown dwarf: 50 Jupiters', 50 * C.Mjup, 1e-12, 'solar'],
  ['A 20 M☉ star, start to supernova', 20 * C.Msun, 1e-12, 'solar'],
  ['Jupiter, squeezed to water density', C.Mjup, 1000, 'solar'],
  ['Earth, as it is', C.Mearth, 5514, 'earth'],
  ['A white dwarf over the limit', 1.5 * C.Msun, 1e10, 'co'],
  ['A Sun of iron at nuclear density', C.Msun, 1e15, 'iron'],
  ['Two Suns of iron, compressed', 2.5 * C.Msun, 1e13, 'iron'],
  ['A tonne of hydrogen in space', 1000, 0.1, 'hydrogen'],
];
const scen = $('scenarios');
for (const [label, M, rho, preset] of SCENARIOS) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  b.addEventListener('click', () => {
    $('preset').value = preset; showComposition(comps, normalizeComp(PRESETS[preset].comp));
    newObject(M, rho, readComposition(comps)); running = true;
    document.querySelector('.speed button[data-s="10"]').click();
  });
  scen.appendChild(b);
}

// start with the Sun as it is today, or with the scenario named in the link (#s1 … #s9)
const m = /^#s(\d+)$/.exec(location.hash);
if (m && scen.children[+m[1] - 1]) {
  scen.children[+m[1] - 1].click();
} else {
  $('preset').value = 'solar'; showComposition(comps, normalizeComp(PRESETS.solar.comp));
  newObject(C.Msun, 1408, readComposition(comps));
}
requestAnimationFrame(frame);
