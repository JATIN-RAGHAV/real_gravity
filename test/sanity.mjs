import { C, CALIB, PRESETS, compStats, normalizeComp, structure, requiredT, adiabaticEquilibrium, coldPressure, nuclearRates, polytrope } from '../src/physics.js';
import { createState, analyze, step, setDensity, fmtTime, fmtR } from '../src/sim.js';

const log = (...a) => console.log(...a);
log('CALIB', { Tc: CALIB.Tc.toExponential(3), rhoC: CALIB.rhoC.toFixed(0), Pc: CALIB.Pc.toExponential(3), n: CALIB.n.toFixed(2), CL: CALIB.CL.toExponential(3), FBURN: CALIB.FBURN.toFixed(3) });

function describe(label, st) {
  const a = analyze(st);
  if (a.phase !== 'object') { log(label, a.phase, a.classification.name); return a; }
  log(label.padEnd(26), a.classification.name.padEnd(36), 'R=' + fmtR(a.R).padEnd(12), 'Tc=' + a.T.toExponential(2), 'rhoC=' + a.s.rhoC.toExponential(2), 'n=' + a.s.n.toFixed(2),
    'Lnuc/Lsun=' + (a.Lnuc / C.Lsun).toExponential(2), 'Lrad/Lsun=' + (a.Lrad / C.Lsun).toExponential(2), 'Teff=' + a.Teff.toFixed(0),
    'deg=' + a.fdeg.toFixed(2), 'n_sup=' + a.support.neutron.toFixed(2));
  return a;
}
function evolve(label, st, nsteps, every = 0) {
  for (let i = 0; i < nsteps; i++) {
    step(st);
    if (every && i % every === 0) describe(label + ' @' + fmtTime(st.time), st);
    if (st.phase !== 'object') break;
  }
  describe(label + ' END @' + fmtTime(st.time), st);
  for (const e of st.events.slice().reverse()) log('   ev', fmtTime(e.t), e.text);
}

// Cold equilibria of known bodies
const cs_rock = compStats(normalizeComp(PRESETS.earth.comp));
const eqE = adiabaticEquilibrium(C.Mearth, C.Rearth * 3, 10, cs_rock);
log('Earth cold eq R/Rearth =', (eqE.R / C.Rearth).toFixed(3));
const cs_h = compStats(normalizeComp(PRESETS.solar.comp));
const eqJ = adiabaticEquilibrium(C.Mjup, C.Rjup * 3, 10, cs_h);
log('Jupiter cold eq R/Rjup =', (eqJ.R / C.Rjup).toFixed(3));
const cs_co = compStats(normalizeComp(PRESETS.co.comp));
for (const m of [0.6, 1.0, 1.3, 1.4, 1.5]) {
  const eq = adiabaticEquilibrium(m * C.Msun, C.Rsun, 10, cs_co);
  log(`C/O WD ${m} Msun cold eq:`, eq.status, fmtR(eq.R));
}
const cs_fe = compStats(normalizeComp(PRESETS.iron.comp));
for (const m of [1.0, 1.4, 2.0, 2.5]) {
  const eq = adiabaticEquilibrium(m * C.Msun, C.Rsun, 10, cs_fe);
  log(`Iron ${m} Msun cold eq:`, eq.status, fmtR(eq.R));
}

// Sun from a cloud
let sun = createState(C.Msun, 1e-3, PRESETS.solar.comp);
describe('Sun cloud', sun);
evolve('Sun', sun, 1500, 500);

let bd = createState(0.05 * C.Msun, 1e-3, PRESETS.solar.comp);
evolve('BD 0.05', bd, 1500, 500);

let mdwarf = createState(0.1 * C.Msun, 1e-3, PRESETS.solar.comp);
evolve('M 0.1', mdwarf, 1500, 500);

let big = createState(20 * C.Msun, 1e-3, PRESETS.solar.comp);
evolve('20 Msun', big, 3000, 1000);

let feball = createState(1.0 * C.Msun, 1e9, PRESETS.iron.comp);
describe('Fe 1 Msun 1e9', feball);
let feball2 = createState(1.0 * C.Msun, 1e15, PRESETS.iron.comp);
describe('Fe 1 Msun 1e15', feball2);
evolve('Fe 1 Msun 1e15', feball2, 5);
let fe2 = createState(2.0 * C.Msun, 1e12, PRESETS.iron.comp);
describe('Fe 2 Msun 1e12', fe2);
evolve('Fe 2 Msun', fe2, 50);
let fe3 = createState(3.0 * C.Msun, 1e13, PRESETS.iron.comp);
evolve('Fe 3 Msun', fe3, 50);
let rock = createState(1e3, 3000, PRESETS.rock.comp);
describe('1 ton rock', rock);
let gas1 = createState(1e3, 1, PRESETS.hydrogen.comp);
describe('1 ton H', gas1); evolve('1 ton H', gas1, 3);
let earth = createState(C.Mearth, 5500, PRESETS.earth.comp);
describe('Earth', earth); evolve('Earth', earth, 3);
let jup = createState(C.Mjup, 1326, PRESETS.solar.comp);
describe('Jupiter', jup); evolve('Jupiter', jup, 3);
let bhtest = createState(C.Msun, 1e19, PRESETS.iron.comp);
describe('Sun-mass 1e19', bhtest);
let ia = createState(1.5 * C.Msun, 1e10, PRESETS.co.comp);
describe('CO 1.5 1e10', ia); evolve('CO 1.5', ia, 200);
log('--- mass scan ---');
for (const m of [0.03, 0.06, 0.08, 0.1, 0.2, 0.5, 2, 5]) {
  const st = createState(m * C.Msun, 1e-3, PRESETS.solar.comp);
  for (let i = 0; i < 3000; i++) { step(st); if (st.phase !== 'object') break; }
  describe(`scan ${m}`, st);
}
log('--- rock sanity ---');
describe('rock 3000', createState(1e3, 3000, PRESETS.rock.comp));
describe('rock 1000', createState(1e3, 1000, PRESETS.rock.comp));
let e2 = createState(C.Mearth, 5500, PRESETS.earth.comp); evolve('Earth2', e2, 3);
let ceres = createState(9.4e20, 2100, PRESETS.rock.comp); evolve('Ceres', ceres, 3);
let fe3b = createState(3.0 * C.Msun, 1e13, PRESETS.iron.comp); evolve('Fe 3 Msun b', fe3b, 50);
let ia2 = createState(1.5 * C.Msun, 1e10, PRESETS.co.comp); evolve('CO 1.5 b', ia2, 200);
let fe2b = createState(2.0 * C.Msun, 1e12, PRESETS.iron.comp); evolve('Fe 2 Msun b', fe2b, 100);
log('--- 20 Msun full ---');
let big3 = createState(20 * C.Msun, 1e-3, PRESETS.solar.comp); evolve('20 Msun c', big3, 30000);
let big4 = createState(40 * C.Msun, 1e-3, PRESETS.solar.comp); evolve('40 Msun', big4, 30000);
let big5 = createState(8 * C.Msun, 1e-3, PRESETS.solar.comp); evolve('8 Msun', big5, 30000);
let sunlong = createState(C.Msun, 1e-3, PRESETS.solar.comp); evolve('Sun long', sunlong, 30000, 10000);
describe('rock 1000 b', createState(1e3, 1000, PRESETS.rock.comp));
