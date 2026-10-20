// sim.js — the object's state, how it responds to the user, and how it evolves in time.
//
// The object has a burning core (mass fraction fcore, composition `comp`) and an envelope
// with the composition the user chose (`env`). Structure uses the mass-weighted mix; nuclear
// burning uses the core.
import {
  C, T_FLOOR, M_TOV, BUCHDAHL, REACTIONS, PRODUCTS, Q_PHOTO, Q_PHOTO_HE, KEYS,
  normalizeComp, compStats, structure, requiredT, adiabaticEquilibrium,
  nuclearRates, neutrinoLoss, photoDisintegration, radiativeLuminosity,
  coreFraction, burnFraction, thermalEnergy, blackHole, coldBranchBelow, temperatureForPressureRatio,
} from './physics.js';

export function createState(M, rho, comp) {
  const c = normalizeComp(comp);
  const st = {
    M, R: radiusFromDensity(M, rho), T: T_FLOOR, comp: c, env: { ...c }, fcore: 1,
    time: 0, events: [], phase: 'object', // 'object' | 'blackhole' | 'gone'
    lastDt: 0, trail: [], ejected: 0, pending: null, envelope: false, coreLocked: false, isNS: false, flashCooldown: 0,
  };
  settle(st);
  return st;
}

export function radiusFromDensity(M, rho) { return Math.cbrt(3 * M / (4 * Math.PI * rho)); }
export function meanDensity(st) { return st.M / (4 / 3 * Math.PI * st.R ** 3); }

export function mixedComp(st) {
  const f = st.fcore, out = {};
  for (const k of KEYS) out[k] = f * (st.comp[k] || 0) + (1 - f) * (st.env[k] || 0);
  out.D = f * (st.comp.D || 0) + (1 - f) * (st.env.D || 0);
  return out;
}

// God mode: the user set M, rho or composition. Give the object whatever heat gravity demands.
export function settle(st) {
  if (st.phase !== 'object') return;
  const cs = compStats(mixedComp(st));
  const Rs = 2 * C.G * st.M / C.c ** 2;
  if (st.R <= BUCHDAHL * Rs) { becomeBlackHole(st, 'Compressed inside its own Schwarzschild radius'); return; }
  const gas = (st.comp.H || 0) + (st.comp.He || 0);
  // a cold solid below its natural density is a loose aggregate: it compacts, it is not vapour
  const loose = gas < 0.5 && meanDensity(st) < cs.rho0;
  const T = loose ? T_FLOOR : requiredT(st.M, st.R, cs, st.M <= M_TOV);
  st.T = T === null ? T_FLOOR : T;
  st.overPressured = !loose && T === null;
  if (T !== null && gas < 0.5 && T < 300) st.T = T_FLOOR;
  // keep the core fraction consistent with the structure
  const s = structure(st.M, st.R, st.T, cs, st.M <= M_TOV);
  st.fcore = st.coreLocked ? 1 : st.envelope ? Math.min(st.fcore, coreFraction(s.n)) : coreFraction(s.n);
}

export function setMass(st, M) {
  if (st.phase === 'blackhole') { st.M = M; return; }
  const rho = meanDensity(st);
  st.M = M; st.R = radiusFromDensity(M, rho);
  settle(st);
}
export function setDensity(st, rho) {
  if (st.phase !== 'object') return;
  st.R = radiusFromDensity(st.M, rho);
  settle(st);
}
export function setComp(st, comp) {
  if (st.phase !== 'object') return;
  st.comp = normalizeComp(comp);
  st.env = { ...st.comp };
  st.envelope = false; st.coreLocked = false; st.isNS = false;
  for (const k of Object.keys(st)) if (k.startsWith('on_') || k.startsWith('ex_')) delete st[k];
  settle(st);
}

function becomeBlackHole(st, why) {
  st.phase = 'blackhole';
  st.R = 2 * C.G * st.M / C.c ** 2;
  logEvent(st, `Black hole formed. ${why}.`, 'collapse');
}

export function logEvent(st, text, kind = 'info') {
  st.events.unshift({ t: st.time, text, kind });
  if (st.events.length > 60) st.events.pop();
  st.pending = { text, kind };
}

// Full diagnostic snapshot of the current state.
export function analyze(st) {
  if (st.phase === 'blackhole') {
    const bh = blackHole(st.M);
    return { phase: 'blackhole', bh, M: st.M, R: bh.Rs, classification: classifyBH(st.M), ejected: st.ejected };
  }
  if (st.phase === 'gone') return { phase: 'gone', M: 0, classification: st.goneClass, ejected: st.ejected };
  const mix = mixedComp(st);
  const cs = compStats(mix);
  const allowN = st.M <= M_TOV;
  const s = structure(st.M, st.R, st.T, cs, allowN);
  s.T = st.T;
  const rates = nuclearRates(s.rhoC, st.T, st.comp, s.cold.fe);
  const fcore = st.fcore, fb = burnFraction();
  const reactions = REACTIONS.map(rx => ({ ...rx, eps: rates[rx.key], L: rates[rx.key] * fb * st.M }));
  const Lnuc = reactions.reduce((a, r) => a + r.L, 0);
  const Lrad = radiativeLuminosity(st.R, s, cs, st.M);
  const Lnu = neutrinoLoss(s.rhoC, st.T) * fb * st.M;
  const photo = photoDisintegration(s.rhoC, st.T, st.comp);
  const Lphoto = (photo.Fe + photo.He) * fb * st.M;
  const Rs = 2 * C.G * st.M / C.c ** 2;
  const Teff = Math.pow(Math.max(Lrad, 1e-30) / (4 * Math.PI * st.R ** 2 * C.sigma), 0.25);
  const Ptot = s.Ptot;
  const safe = (x) => (Ptot > 1e-30 && isFinite(x / Ptot) ? x / Ptot : 0);
  const support = {
    electron: safe(s.cold.electron), neutron: safe(s.cold.neutron),
    ion: safe(s.th.ion), eth: safe(s.th.electron), rad: safe(s.th.rad),
  };
  const fdeg = support.electron + support.neutron;
  const g = C.G * st.M / st.R ** 2;
  const vesc = Math.sqrt(2 * C.G * st.M / st.R);
  const Uth = thermalEnergy(s.rhoC, st.T, cs) * st.M * 0.5;
  const Omega = -s.poly.alpha * C.G * st.M * st.M / st.R;
  const tff = Math.sqrt(3 * Math.PI / (32 * C.G * s.rhoMean));
  const Ltot = Lrad + Lnu + Lphoto;
  const tKH = Uth / Math.max(Ltot, 1e-30);
  const dominant = reactions.reduce((a, r) => (r.L > a.L ? r : a), { L: 0 });
  const LEdd = 4 * Math.PI * C.G * st.M * C.c / (0.02 * (1 + cs.X));
  const isStatic = Lnuc <= 0 && tKH > 1e14 * C.yr && !st.overPressured;
  const gammaEff = 1 + 1 / Math.max(s.n, 0.01);
  const Ebind = Math.abs(Omega) * Math.max(0.1, 1 - 1 / (3 * (gammaEff - 1)));
  let tNuc = Infinity;
  if (dominant.L > 0) {
    const fuel = (dominant.fuels || [dominant.fuel]).reduce((acc, f) => acc + (st.comp[f] || 0), 0);
    tNuc = fuel * dominant.Q * fcore * st.M / dominant.L;
  }
  const out = {
    phase: 'object', M: st.M, R: st.R, T: st.T, comp: st.comp, mix, cs, s, rates, reactions,
    Lnuc, Lrad, Lnu, Lphoto, photo, Teff, support, fdeg, g, vesc, Uth, Omega, Ebind, tff, tKH, tNuc, Rs,
    dominant: dominant.L > 0 ? dominant : null, fcore, LEdd, isStatic,
    compactness: Rs / st.R, overPressured: !!st.overPressured, compression: s.rhoC / cs.rho0,
    rhoMean: s.rhoMean, ejected: st.ejected, envelope: st.envelope,
  };
  out.classification = classify(out);
  return out;
}

function classifyBH(M) {
  const msun = M / C.Msun;
  let name = 'Black hole';
  if (M < 1e23) name = 'Primordial-scale black hole';
  else if (msun < 100) name = 'Stellar-mass black hole';
  else if (msun < 1e5) name = 'Intermediate-mass black hole';
  else name = 'Supermassive black hole';
  return {
    name, kind: 'blackhole',
    summary: 'Nothing holds it up. Inside the event horizon every path leads inward. Mass, horizon radius and Hawking temperature are all that remain.',
  };
}

function classify(a) {
  const { M, T, comp, support, fdeg, Lnuc, Lrad, dominant, cs } = a;
  const msun = M / C.Msun, mjup = M / C.Mjup;
  const gas = (comp.H || 0) + (comp.He || 0);
  const burning = dominant && Lnuc > 0.3 * Math.max(Lrad, 1e-30);
  const mats = materialName(comp);
  if (a.overPressured) {
    if (a.compression < 8 && gas < 0.5) return { name: 'Squeezed ' + mats + ' body', kind: 'unstable', summary: 'Compressed beyond its natural density. Its bonds push back harder than gravity pulls, so it springs back to solid density when released.' };
    return { name: 'Over-compressed ' + mats, kind: 'unstable', summary: 'Internal pressure exceeds what gravity can hold. Released, it rebounds to its equilibrium size on the dynamical timescale.' };
  }
  if (support.neutron > 0.5) {
    return { name: 'Neutron star', kind: 'neutron', summary: 'Electrons were forced into protons; the object is a giant nucleus held up by neutron degeneracy pressure, a dozen kilometres across.' };
  }
  if ((comp.n || 0) > 0.5) return { name: 'Nucleon soup', kind: 'collapse', summary: 'Photodisintegration has undone every nucleus. Nothing exothermic is left; only collapse can follow.' };
  if (burning && fdeg > 0.8 && ['3a', 'CC', 'OO'].includes(dominant.key)) {
    return { name: 'Degenerate ' + mats + ' sphere igniting', kind: 'collapse', summary: 'Fusion has started inside degenerate matter. Degenerate pressure does not rise with temperature, so nothing throttles the burning: a thermonuclear runaway is about to begin.' };
  }
  if (burning && (fdeg < 0.5 || dominant.key === 'pD')) {
    const k = dominant.key;
    if (k === 'pD') return { name: 'Brown dwarf (deuterium burning)', kind: 'brown', summary: 'Too light to ignite ordinary hydrogen, it burns its trace deuterium at about a million kelvin for a few million years, then cools forever.' };
    if ((k === 'pp' || k === 'CNO') && Lnuc < 1e-4 * C.Lsun && fdeg > 0.25) return BROWN;
    if (k === 'pp' || k === 'CNO') {
      const sp = spectralType(a.Teff);
      const cno = k === 'CNO';
      return { name: `${sp} main-sequence star`, kind: 'star', summary: `Hydrogen fuses to helium in the core (${cno ? 'CNO cycle, as sensitive as T¹⁷' : 'pp chain'}). Thermal pressure balances gravity and the burning rate regulates itself: squeeze it and it burns faster, expands, and cools.` };
    }
    if (k === '3a') return { name: 'Helium-burning star', kind: 'star', summary: 'Three helium nuclei fuse to carbon (and carbon captures helium to make oxygen) at ~10⁸ K.' };
    if (k === 'CC') return { name: 'Carbon-burning star', kind: 'star', summary: 'Carbon fuses at ~6×10⁸ K to neon and magnesium. Neutrino losses now dominate the energy budget; this phase lasts centuries, not aeons.' };
    if (k === 'Ne') return { name: 'Neon-burning star', kind: 'star', summary: 'Photodisintegration-driven neon burning at ~1.3×10⁹ K. A matter of years.' };
    if (k === 'OO') return { name: 'Oxygen-burning star', kind: 'star', summary: 'Oxygen fuses to silicon and sulfur at ~1.5–2×10⁹ K. Months remain.' };
    if (k === 'Si') return { name: 'Silicon-burning star', kind: 'star', summary: 'Silicon burns to iron-group nuclei at ~3×10⁹ K. Iron is the end of the exothermic road; the core has about a day left.' };
  }
  if (fdeg > 0.5 && a.compression < 8 && gas < 0.5) {
    if (a.s.Pc < 1e8) return { name: capital(mats) + ' body', kind: 'rock', summary: 'Gravity is weaker than material strength (central pressure below ~10⁸ Pa), so it need not be round. A rock, an asteroid, or a moonlet.' };
    return { name: capital(mats) + ' planet', kind: 'planet', summary: 'Self-gravity has rounded it and compresses its interior. Chemical bonds and electron repulsion hold it up, and its size grows with mass.' };
  }
  if (fdeg > 0.5) {
    if (msun > 0.08 && gas < 0.5) {
      const n = comp.Fe > 0.5 ? 'Iron white dwarf' : comp.He > 0.5 ? 'Helium white dwarf' : (comp.O + comp.Ne + comp.Mg > 0.6 && comp.C < 0.3) ? 'O–Ne–Mg white dwarf' : 'Carbon–oxygen white dwarf';
      return { name: T > 3e4 ? n : 'Cold ' + n.toLowerCase(), kind: 'wd', summary: `Supported by electron degeneracy pressure, which does not depend on temperature, so it can only cool. Mass ${msun.toFixed(2)} M☉ against the Chandrasekhar limit of ~1.4 M☉.` };
    }
    if (gas >= 0.5) {
      if (mjup >= 13 && msun < 0.08) return BROWN;
      if (msun >= 0.08) return { name: 'Degenerate hydrogen–helium object', kind: 'brown', summary: 'Heavy enough for a star, but the degenerate core is too cool to burn hydrogen. In practice this is a star that has not finished contracting.' };
      return { name: 'Gas giant planet', kind: 'planet', summary: 'A hydrogen–helium sphere compressed to metallic density at its centre. Its size barely depends on its mass: more mass means more compression.' };
    }
    return { name: 'Degenerate ' + mats + ' sphere', kind: 'planet', summary: 'Electron degeneracy, not chemical bonds, sets its size. Adding mass makes it smaller.' };
  }
  // thermal support
  if (T <= T_FLOOR * 1.5 || (gas < 0.5 && T < 300)) {
    if (gas >= 0.5) return { name: 'Diffuse gas cloud', kind: 'cloud', summary: 'Gravity is too weak to compress it against its own thermal pressure at 10 K. Below its Jeans mass it would simply disperse.' };
    return { name: 'Loose ' + mats + ' aggregate', kind: 'rock', summary: 'Below its natural density and too cold for gas pressure. Gravity will gently pack it to solid density.' };
  }
  if (gas < 0.5 && fdeg > 0.1) return { name: 'Hot degenerate ' + mats + ' core', kind: 'wd', summary: 'Mostly degenerate, with a hot ion gas adding the rest of the support. It is contracting as it radiates and loses neutrinos.' };
  if (T > 3e9) return { name: 'Collapsing core', kind: 'collapse', summary: 'Hotter than 3×10⁹ K with no exothermic fuel left. Photodisintegration and neutrino losses drain the pressure support; collapse follows on the free-fall time.' };
  if (gas >= 0.5 && mjup >= 13 && msun < 0.08 && fdeg > 0.25) return BROWN;
  if (T > 1e6) {
    if (comp.H > 0.05 && msun >= 0.075) return { name: 'Pre-main-sequence star', kind: 'proto', summary: 'A contracting ball of gas, heated by its own gravity (Kelvin–Helmholtz contraction). It will ignite hydrogen when the centre reaches a few million kelvin.' };
    if (comp.H > 0.05) return { name: 'Contracting sub-stellar object', kind: 'proto', summary: 'Shrinking and heating, but it will go degenerate before hydrogen ignition.' };
    return { name: 'Contracting ' + mats + ' core', kind: 'proto', summary: 'A hot, gas-pressure supported ball with no hydrogen to burn. It contracts and heats until the next fuel ignites or degeneracy takes over.' };
  }
  return { name: 'Protostellar gas sphere', kind: 'proto', summary: 'Bound by its own gravity and slowly contracting as it radiates. Central temperature is still below 10⁶ K.' };
}

const BROWN = { name: 'Brown dwarf', kind: 'brown', summary: 'Between 13 and 80 Jupiter masses: degenerate electrons stop the contraction before hydrogen can ignite in earnest. It glows from stored heat and, at most, a trickle of fusion, and cools forever.' };
const FUELNAME = { D: 'Deuterium', H: 'Hydrogen', He: 'Helium', C: 'Carbon', Ne: 'Neon', O: 'Oxygen', Si: 'Silicon' };
function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function materialName(comp) {
  const gas = (comp.H || 0) + (comp.He || 0);
  if (gas > 0.5) return comp.H > comp.He ? 'hydrogen' : 'helium';
  if ((comp.Fe || 0) > 0.5) return 'iron';
  if ((comp.C || 0) > 0.5) return 'carbon';
  if ((comp.O || 0) > 0.6 && (comp.H || 0) > 0.05) return 'ice';
  if ((comp.Si || 0) > 0.5) return 'silicon';
  if ((comp.Ne || 0) > 0.15 && (comp.Si || 0) < 0.2) return 'oxygen–neon–magnesium';
  if ((comp.C || 0) + (comp.O || 0) > 0.6) return 'carbon–oxygen';
  if ((comp.Si || 0) + (comp.Mg || 0) + (comp.O || 0) > 0.5) return 'rocky';
  if ((comp.Ne || 0) > 0.5) return 'neon';
  return 'mixed-material';
}
export function spectralType(Teff) {
  if (Teff >= 30000) return 'O-type'; if (Teff >= 10000) return 'B-type'; if (Teff >= 7500) return 'A-type';
  if (Teff >= 6000) return 'F-type'; if (Teff >= 5200) return 'G-type'; if (Teff >= 3700) return 'K-type';
  return 'M-type';
}

// ---------- Time evolution ----------
export function step(st) {
  if (st.phase !== 'object') return analyze(st);
  const a = analyze(st);
  const Lnet = a.Lrad + a.Lnu + a.Lphoto - a.Lnuc; // energy leaving per second
  const Ltot = a.Lrad + a.Lnu + a.Lphoto + a.Lnuc;
  // --- time step ---
  let dt = 0.03 * a.Uth / Math.max(Math.abs(Lnet), 1e-30);
  dt = Math.min(dt, 0.03 * a.Uth / Math.max(Ltot, 1e-30));
  for (const r of a.reactions) if (r.L > 0) {
    const fuel = (r.fuels || [r.fuel]).reduce((acc, f) => acc + (st.comp[f] || 0), 0);
    dt = Math.min(dt, 0.02 * Math.max(fuel, 1e-4) * r.Q * a.fcore * st.M / r.L);
  }
  if (a.photo.Fe > 0) dt = Math.min(dt, 0.05 * Math.max(st.comp.Fe, 1e-3) * Q_PHOTO / a.photo.Fe);
  if (a.photo.He > 0) dt = Math.min(dt, 0.05 * Math.max(st.comp.He, 1e-3) * Q_PHOTO_HE / a.photo.He);
  dt = Math.min(dt, 1e10 * C.yr);
  if (a.s.Ptot < 0.5 * a.s.Pc) dt = Math.min(dt, 0.1 * a.tff); // unsupported: it is falling, not waiting
  if (!isFinite(dt) || dt <= 0) dt = C.yr;

  // --- hydrostatic assumption fails: thermal timescale within ~10 free-fall times ---
  if (dt < 0.3 * a.tff && st.T > 1e9 && Lnet > 0 && !st.isNS) {
    st.lastDt = a.tff; st.time += a.tff;
    collapseEvent(st, a, st.R);
    return analyze(st);
  }
  dt = Math.max(dt, 1e-6);
  st.lastDt = dt;
  const t0 = st.time;
  st.time += dt;

  // --- thermonuclear runaway in degenerate matter ---
  if (a.fdeg > 0.8 && a.dominant && a.Lnuc > 10 * (a.Lrad + a.Lnu) && ['3a', 'CC', 'OO'].includes(a.dominant.key)) {
    const rx = a.dominant;
    // a detonation burns the whole object to iron-group nuclei (~0.8 MeV per nucleon)
    const Efuel = ((a.mix.He || 0) + (a.mix.C || 0) + (a.mix.O || 0)) * 7.7e13 * st.M;
    // a detonation needs the burning front to outrun expansion: only at high density
    if (Efuel > a.Ebind && a.s.rhoC > 1e10) {
      st.phase = 'gone';
      st.goneClass = { name: 'Thermonuclear supernova (Type Ia-like)', kind: 'gone', summary: `Degenerate fuel ignited. With no thermal expansion to throttle it, the burning ran away and released ${fmtE(Efuel)} J, more than the ${fmtE(a.Ebind)} J binding energy. Nothing is left but an expanding cloud of iron-group ash.` };
      logEvent(st, 'Thermonuclear runaway in degenerate matter: the object detonates.', 'boom');
      return analyze(st);
    }
    if (st.flashCooldown <= 0) {
      st.T = Math.max(st.T, temperatureForPressureRatio(a.s.rhoC, a.cs, 2));
      st.flashCooldown = 200;
      logEvent(st, `${rx.label} flash in degenerate matter: degeneracy lifted, the core expands.`, 'ignite');
    }
  }
  if (st.flashCooldown > 0) st.flashCooldown--;

  // --- composition change (core) ---
  const fcoreM = a.fcore * st.M;
  const comp = { ...st.comp };
  for (const r of a.reactions) if (r.L > 0) {
    const fuels = r.fuels || [r.fuel];
    const avail = fuels.reduce((acc, f) => acc + (comp[f] || 0), 0);
    const dX = Math.min(avail, r.L * dt / (r.Q * fcoreM));
    if (avail > 0) for (const f of fuels) comp[f] -= dX * (comp[f] || 0) / avail;
    for (const [p, f] of Object.entries(PRODUCTS[r.key])) comp[p] = (comp[p] || 0) + dX * f;
  }
  if (a.photo.Fe > 0) {
    const dX = Math.min(comp.Fe, a.photo.Fe * dt / Q_PHOTO);
    comp.Fe -= dX; comp.He += dX;
  }
  if (a.photo.He > 0) {
    const dX = Math.min(comp.He, a.photo.He * dt / Q_PHOTO_HE);
    comp.He -= dX; comp.n = (comp.n || 0) + dX;
  }
  // ignition / exhaustion events
  for (const r of a.reactions) {
    const on = r.L > 0.05 * Math.max(a.Lrad + a.Lnu, 1e-30) && r.L > 1e-12 * C.Lsun;
    const key = 'on_' + r.key;
    if (on && !st[key]) {
      st[key] = true; st['ex_' + r.fuel] = false;
      if (a.fcore < 0.99 && !st.coreLocked) st.envelope = true;
      logEvent(st, `${r.label} ignited at T = ${fmtT(st.T)} K.`, 'ignite');
    }
    const fuelLeft = (r.fuels || [r.fuel]).reduce((acc, f) => acc + (comp[f] || 0), 0);
    if (!on && st[key] && fuelLeft < 1e-3) {
      st[key] = false;
      if (!st['ex_' + r.fuel]) { st['ex_' + r.fuel] = true; logEvent(st, `${FUELNAME[r.fuel]} exhausted in the core.`, 'info'); }
    }
  }
  st.comp = comp;

  // --- planetary nebula: a degenerate, burnt-out core sheds its envelope ---
  if (st.envelope && !st.coreLocked && a.fcore < 0.99 && a.fdeg > 0.5 && a.Lnuc < 0.01 * a.Lrad && st.T < 5e8) {
    const Mwd = Math.min(st.M, Math.max(a.fcore * st.M, 0.08 * st.M + 0.47 * C.Msun));
    if (Mwd < st.M) {
      const Mold = st.M;
      st.ejected += Mold - Mwd;
      logEvent(st, `Planetary nebula: the ${((Mold - Mwd) / C.Msun).toFixed(2)} M☉ envelope drifts away, exposing the ${(Mwd / C.Msun).toFixed(2)} M☉ degenerate core.`, 'boom');
      st.M = Mwd; st.env = { ...st.comp }; st.fcore = 1; st.envelope = false; st.coreLocked = true;
      st.R = st.R * Math.cbrt(Mwd / Mold);
    }
  }

  // --- cooling / heating at fixed radius ---
  const cs2 = compStats(mixedComp(st));
  const uNow = thermalEnergy(a.s.rhoC, st.T, cs2);
  const uNew = uNow - Lnet * dt / (0.5 * st.M);
  let Tnew;
  if (uNew <= thermalEnergy(a.s.rhoC, T_FLOOR, cs2)) Tnew = T_FLOOR;
  else {
    let lo = Math.log(T_FLOOR), hi = Math.log(1e13);
    for (let i = 0; i < 50; i++) {
      const mid = 0.5 * (lo + hi);
      if (thermalEnergy(a.s.rhoC, Math.exp(mid), cs2) < uNew) lo = mid; else hi = mid;
    }
    Tnew = Math.exp(0.5 * (lo + hi));
  }
  st.T = Math.min(Tnew, 1e12);
  st.overPressured = false;

  // --- adiabatic re-equilibration ---
  const eq = adiabaticEquilibrium(st.M, st.R, st.T, cs2);
  const Rold = st.R;
  if (eq.status === 'unbound') {
    st.time = t0 + a.tff;
    st.phase = 'gone';
    st.goneClass = { name: 'Dispersed gas', kind: 'gone', summary: 'Thermal pressure at 10 K beat gravity at every radius: the object was below its Jeans mass and drifted apart.' };
    logEvent(st, 'Gravity lost: the gas disperses.', 'boom');
    return analyze(st);
  }
  const dense = a.fdeg > 0.3 || a.T > 1e8;
  if (eq.status === 'blackhole') { collapseEvent(st, a, Rold); return analyze(st); }
  st.R = eq.R; st.T = eq.T;
  // contraction cannot outrun free fall: charge the clock for the dynamical time it needs
  const shrink = (Rold - eq.R) / Rold;
  if (shrink > 0) {
    const tdyn = 1.5 * shrink * a.tff;
    if (tdyn > dt) {
      st.time += tdyn - dt; st.lastDt = tdyn;
      if (Rold / eq.R > 2 && !st.freefallNoted) {
        st.freefallNoted = true;
        logEvent(st, `Free fall: too transparent to hold its heat, the gas falls inward for ${fmtTime(tdyn)} until it becomes opaque and a hydrostatic core forms.`, 'info');
      }
    }
  }
  if (Rold / eq.R > 3 && !st.isNS && dense) collapseEvent(st, a, Rold);
  else if (eq.R / Rold > 3) {
    logEvent(st, `Rebound: pressure pushed the object out from ${fmtR(Rold)} to ${fmtR(eq.R)} (dynamical time ≈ ${fmtTime(a.tff)}).`, 'info');
    st.time += a.tff;
  }
  if (st.phase === 'object') {
    const a2 = analyze(st);
    st.fcore = st.coreLocked ? 1 : st.envelope ? Math.min(st.fcore, coreFraction(a2.s.n)) : coreFraction(a2.s.n);
    st.trail.push([Math.log10(a2.s.rhoC), Math.log10(st.T)]);
    if (st.trail.length > 600) st.trail.shift();
    return a2;
  }
  return analyze(st);
}

function collapseEvent(st, a, Rold) {
  const msun = st.M / C.Msun;
  let Mrem = st.M;
  if (st.envelope && a.fcore < 0.99 && msun > 1.3) Mrem = Math.min(st.M, Math.max(a.fcore * st.M, 1.25 * C.Msun));
  if (Mrem < st.M) {
    st.ejected += st.M - Mrem;
    logEvent(st, `Core collapse in ${fmtTime(a.tff)}. The ${((st.M - Mrem) / C.Msun).toFixed(2)} M☉ envelope is blown off in a supernova; a ${(Mrem / C.Msun).toFixed(2)} M☉ core remains.`, 'boom');
    st.M = Mrem;
  } else {
    logEvent(st, `Dynamical collapse in ${fmtTime(a.tff)}: pressure support failed at ${fmtR(Rold)}.`, 'collapse');
  }
  st.env = { ...st.comp }; st.fcore = 1; st.envelope = false; st.coreLocked = true;
  if (st.M > M_TOV) { becomeBlackHole(st, `${(st.M / C.Msun).toFixed(2)} M☉ exceeds the ${(M_TOV / C.Msun).toFixed(1)} M☉ neutron-star limit`); return; }
  // fall to the next cold branch that can hold the mass
  const cs = compStats(mixedComp(st));
  const R = coldBranchBelow(st.M, Rold * 0.9, cs);
  if (R === null) { becomeBlackHole(st, 'No equilibrium exists for this mass'); return; }
  const rhoOld = a.s.rhoC;
  st.R = R;
  st.overPressured = false;
  const s2 = structure(st.M, st.R, T_FLOOR, cs, st.M <= M_TOV);
  // shock heating: adiabatic compression of the thermal content, capped where thermal pressure
  // would reach a third of the cold support
  const Tad = Math.min(1e12, st.T * Math.pow(s2.rhoC / rhoOld, 1 / 3));
  st.T = Math.min(Tad, temperatureForPressureRatio(s2.rhoC, cs, 0.3));
  const a2 = analyze(st);
  if (a2.support.neutron > 0.3) {
    st.isNS = true;
    st.comp = normalizeComp({ n: 1 }); st.env = { ...st.comp };
    logEvent(st, `Neutron star formed: ${(st.M / C.Msun).toFixed(2)} M☉ in ${fmtR(st.R)}, cooling by neutrino emission.`, 'ignite');
  } else {
    logEvent(st, `Settled on the degenerate branch at ${fmtR(st.R)}.`, 'info');
  }
}

export function fmtE(x) { return x.toExponential(1).replace('e+', '×10^'); }
export function fmtT(T) { return T >= 1e4 ? T.toExponential(2).replace('e+', '×10^') : T.toFixed(0); }
export function fmtR(R) {
  if (R < 1e3) return R.toFixed(1) + ' m';
  if (R < 1e6) return (R / 1e3).toFixed(1) + ' km';
  if (R < 0.3 * C.Rsun) return (R / 1e3).toExponential(2).replace('e+', '×10^') + ' km';
  return (R / C.Rsun).toPrecision(3) + ' R☉';
}
export function fmtTime(s) {
  if (s < 1e-3) return s.toExponential(1) + ' s';
  if (s < 60) return s.toPrecision(2) + ' s';
  if (s < 3600) return (s / 60).toPrecision(2) + ' min';
  if (s < 86400 * 2) return (s / 3600).toPrecision(2) + ' h';
  if (s < C.yr) return (s / 86400).toPrecision(2) + ' d';
  const y = s / C.yr;
  if (y < 1e3) return y.toPrecision(3) + ' yr';
  if (y < 1e6) return (y / 1e3).toPrecision(3) + ' kyr';
  if (y < 1e9) return (y / 1e6).toPrecision(3) + ' Myr';
  if (y < 1e12) return (y / 1e9).toPrecision(3) + ' Gyr';
  return y.toExponential(2).replace('e+', '×10^') + ' yr';
}
