// physics.js — one-zone stellar-structure physics in SI units.
//
// The model: a single self-gravitating sphere described by its mass M, radius R,
// central temperature T and (core) composition. Structure comes from Lane-Emden
// polytropes (central density and pressure follow from M, R and an effective
// polytropic index set by the equation of state). Pressure is the sum of
//   - cold pressure: degenerate electrons (exact T=0 Fermi gas, with a lattice/Coulomb
//     correction calibrated so the material is at zero pressure at its laboratory density),
//     electron capture (neutronization) above a composition-dependent density, and
//     degenerate neutrons,
//   - thermal pressure: ideal ions, thermal electrons (suppressed by degeneracy), radiation.
// Energy sources and sinks: deuterium, pp, CNO, triple-alpha, carbon, neon, oxygen and
// silicon burning; radiative diffusion (calibrated to the Sun); pair-neutrino losses;
// photodisintegration of iron as an energy sink. General relativity enters as the
// Buchdahl/Schwarzschild limit and the TOV maximum mass for neutron-degenerate support.

export const C = {
  G: 6.6743e-11, c: 2.99792458e8, k: 1.380649e-23, mu: 1.66053907e-27,
  me: 9.1093837e-31, mn: 1.6749275e-27, h: 6.62607015e-34, hbar: 1.054571817e-34,
  sigma: 5.670374419e-8, a: 7.565733e-16, qe: 1.602176634e-19,
  Msun: 1.98847e30, Rsun: 6.957e8, Lsun: 3.828e26,
  Mearth: 5.9722e24, Rearth: 6.371e6, Mjup: 1.89813e27, Rjup: 7.1492e7,
  yr: 3.15576e7, pc: 3.0857e16, AU: 1.495978707e11,
};

export const T_FLOOR = 10;            // K — ambient temperature of a dark molecular cloud
export const M_TOV = 2.3 * C.Msun;    // maximum mass of a neutron star (GR, TOV)
export const BUCHDAHL = 1.41;         // R < 1.41 R_s: no causal equation of state can hold it up (Buchdahl 9/8 is the absolute GR bound)

// Species: A, Z, laboratory (zero-pressure, cold) density, electron-capture threshold density.
export const SPECIES = [
  // rho0: cold zero-pressure density (O, Mg, Si as they occur in silicates); K0: bulk modulus; Tvap: temperature above
  // which the species behaves as a gas (below it, no thermal pressure: bonds hold the solid together).
  { key: 'H',  name: 'Hydrogen',  A: 1.008,  Z: 1,  rho0: 86,   rhoCap: 1.2e10, Tvap: 5,    K0: 0.2e9 },
  { key: 'He', name: 'Helium',    A: 4.0026, Z: 2,  rho0: 150,  rhoCap: 1e14,   Tvap: 2,    K0: 0.1e9 },
  { key: 'C',  name: 'Carbon',    A: 12.011, Z: 6,  rho0: 2260, rhoCap: 4e13,   Tvap: 4000, K0: 35e9 },
  { key: 'O',  name: 'Oxygen',    A: 15.999, Z: 8,  rho0: 2800, rhoCap: 2e13,   Tvap: 90,   K0: 100e9 },
  { key: 'Ne', name: 'Neon',      A: 20.180, Z: 10, rho0: 1500, rhoCap: 6e12,   Tvap: 27,   K0: 1e9 },
  { key: 'Mg', name: 'Magnesium', A: 24.305, Z: 12, rho0: 3000, rhoCap: 3e12,   Tvap: 1400, K0: 120e9 },
  { key: 'Si', name: 'Silicon',   A: 28.085, Z: 14, rho0: 2650, rhoCap: 2e12,   Tvap: 3000, K0: 100e9 },
  { key: 'Fe', name: 'Iron',      A: 55.845, Z: 26, rho0: 7874, rhoCap: 1.1e12, Tvap: 3100, K0: 170e9 },
  // free nucleons left by photodisintegration; they do not fuse back on any relevant timescale
  { key: 'n',  name: 'Free nucleons', A: 1, Z: 0.5, rho0: 86, rhoCap: 1.2e10, Tvap: 1, K0: 0.2e9, hidden: true },
];
export const KEYS = SPECIES.map(s => s.key);
export const USER_KEYS = SPECIES.filter(s => !s.hidden).map(s => s.key);
const SP = Object.fromEntries(SPECIES.map(s => [s.key, s]));

export const D_TO_H = 3e-5; // primordial deuterium mass fraction relative to hydrogen

export const PRESETS = {
  solar:   { label: 'Solar gas',        comp: { H: 0.70, He: 0.28, C: 0.006, O: 0.014 } },
  hydrogen:{ label: 'Pure hydrogen',    comp: { H: 1 } },
  helium:  { label: 'Pure helium',      comp: { He: 1 } },
  co:      { label: 'Carbon–oxygen',    comp: { C: 0.5, O: 0.5 } },
  ice:     { label: 'Water ice',        comp: { H: 0.112, O: 0.888 } },
  rock:    { label: 'Rock (silicate)',  comp: { O: 0.44, Si: 0.22, Mg: 0.20, Fe: 0.14 } },
  earth:   { label: 'Earth-like',       comp: { Fe: 0.35, O: 0.31, Si: 0.17, Mg: 0.17 } },
  iron:    { label: 'Pure iron',        comp: { Fe: 1 } },
  carbon:  { label: 'Pure carbon',      comp: { C: 1 } },
};

export function normalizeComp(comp) {
  const out = {};
  let sum = 0;
  for (const k of KEYS) { const v = Math.max(0, comp[k] || 0); out[k] = v; sum += v; }
  if (sum <= 0) { out.H = 1; sum = 1; }
  for (const k of KEYS) out[k] /= sum;
  out.D = comp.D !== undefined ? comp.D : D_TO_H * out.H;
  return out;
}

// Mean molecular weights and material constants for a composition.
export function compStats(comp) {
  let invMuI = 0, invMuE = 0, z23 = 0, invRho0 = 0, logCap = 0, invK = 0;
  for (const s of SPECIES) {
    const x = comp[s.key] || 0;
    invMuI += x / s.A;
    invMuE += x * s.Z / s.A;
    z23 += x * s.Z / s.A * Math.cbrt(s.Z * s.Z);
    invRho0 += x / s.rho0;
    logCap += x * Math.log(s.rhoCap);
  }
  for (const s of SPECIES) { const x = comp[s.key] || 0; invK += (x / s.rho0) / invRho0 / s.K0; }
  const X = comp.H || 0, Y = comp.He || 0;
  const vap = (T) => { // mass fraction of the material that is a gas at T
    let f = 0;
    for (const sp of SPECIES) { const x = comp[sp.key] || 0; if (x) f += x / (1 + Math.exp(-(Math.log10(T / sp.Tvap)) / 0.03)); }
    return f < 1e-6 ? 0 : f;
  };
  return {
    vap, muI: 1 / invMuI, muE: 1 / invMuE, mu: 1 / (invMuI + invMuE),
    Z23: z23 / invMuE, rho0: 1 / invRho0, rhoCap: Math.exp(logCap), K0: 1 / invK,
    X, Y, Zmet: Math.max(0, 1 - X - Y),
  };
}

// ---------- Degenerate Fermi gases (exact zero-temperature expressions) ----------
const A_E = Math.PI * C.me ** 4 * C.c ** 5 / (3 * C.h ** 3);          // 6.0e21 Pa
const N_E = 8 * Math.PI / 3 * (C.me * C.c / C.h) ** 3;                 // 5.87e35 m^-3
const A_N = A_E * (C.mn / C.me) ** 4;
const N_N = N_E * (C.mn / C.me) ** 3;

function fermiF(x) {
  if (x < 1e-2) return 1.6 * x ** 5 * (1 - (5 / 14) * x * x);
  return x * (2 * x * x - 3) * Math.sqrt(x * x + 1) + 3 * Math.asinh(x);
}
export function pFermiElectron(ne) { return ne <= 0 ? 0 : A_E * fermiF(Math.cbrt(ne / N_E)); }
export function pFermiNeutron(nn) { return nn <= 0 ? 0 : A_N * fermiF(Math.cbrt(nn / N_N)); }

// Fraction of electrons surviving electron capture at density rho.
export function electronFraction(rho, cs) { return 1 / Math.sqrt(1 + rho / cs.rhoCap); }

// Cold (T = 0) pressure of matter at density rho. Returns Pa and the parts.
export function coldPressure(rho, cs, allowNeutrons = true) {
  const fe = electronFraction(rho, cs);
  const ne = fe * rho / (cs.muE * C.mu);
  const Pe = pFermiElectron(ne);
  // Lattice/Coulomb correction ∝ n_e^{4/3}, calibrated to vanish at the laboratory density.
  const ne0 = cs.rho0 / (cs.muE * C.mu);
  const Pcorr = pFermiElectron(ne0) * Math.pow(ne / ne0, 4 / 3);
  const PeTF = Math.max(0, Pe - Pcorr);
  // Below a few-fold compression the Thomas-Fermi picture is too stiff: use the
  // Birch-Murnaghan equation of state of the solid with its measured bulk modulus.
  const eta = rho / cs.rho0;
  let PeC = PeTF;
  if (eta > 1 && eta < 20) {
    const Pbm = 1.5 * cs.K0 * (Math.pow(eta, 7 / 3) - Math.pow(eta, 5 / 3));
    const t = Math.min(1, Math.max(0, (Math.log10(eta) - 0.5) / 0.8));
    const h = t * t * (3 - 2 * t);
    PeC = h * PeTF + (1 - h) * Math.min(Pbm, PeTF);
  }
  const nn = rho > 0.01 * cs.rhoCap ? (1 - fe) * rho / C.mn : 0;
  const Pn = allowNeutrons ? pFermiNeutron(nn) : 0;
  return { total: PeC + Pn, electron: PeC, neutron: Pn, fe };
}

export function coldGamma(rho, cs, allowNeutrons = true) {
  const d = 0.02;
  const p1 = coldPressure(rho * (1 - d), cs, allowNeutrons).total;
  const p2 = coldPressure(rho * (1 + d), cs, allowNeutrons).total;
  if (p1 <= 0 || p2 <= 0) return 5 / 3;
  return Math.log(p2 / p1) / Math.log((1 + d) / (1 - d));
}

// Ionization fraction (crude Saha stand-in): hydrogen ionizes around 1e4 K.
export function ionFraction(T) {
  const s = (Math.log10(Math.max(T, 1)) - 4.0) / 0.25;
  return 1 / (1 + Math.exp(-s));
}

// Thermal pressure parts at (rho, T).
export function thermalPressure(rho, T, cs) {
  const fion = ionFraction(T);
  const fe = electronFraction(rho, cs);
  const nI = rho / (cs.muI * C.mu);
  const neFree = fion * fe * rho / (cs.muE * C.mu);
  const gasFrac = cs.vap(T);
  const Pion = nI * C.k * T * gasFrac;
  const Pid = neFree * C.k * T * gasFrac;
  const Pdeg = pFermiElectron(neFree);
  const Peth = Math.sqrt(Pdeg * Pdeg + Pid * Pid) - Pdeg;    // degeneracy suppresses thermal electrons
  const Prad = C.a * T ** 4 / 3;
  return { total: Pion + Peth + Prad, ion: Pion, electron: Peth, rad: Prad, fion };
}

// Thermal energy per kg at (rho, T).
export function thermalEnergy(rho, T, cs) {
  const p = thermalPressure(rho, T, cs);
  return 1.5 * (p.ion + p.electron) / rho + C.a * T ** 4 / rho;
}

// ---------- Polytropes (Lane-Emden) ----------
// n, xi1, -xi^2 theta'(xi1)
const LE = [
  [0, 2.44949, 4.89898], [0.5, 2.75270, 3.78865], [1, 3.14159, 3.14159],
  [1.5, 3.65375, 2.71406], [2, 4.35287, 2.41105], [2.5, 5.35528, 2.18720],
  [3, 6.89685, 2.01824], [3.5, 9.53581, 1.89056], [4, 14.97155, 1.79723],
  [4.5, 31.8365, 1.73780],
];
const LE_TAB = LE.map(([n, xi, m]) => {
  const th = m / (xi * xi);
  return { n, D: xi / (3 * th), W: 1 / (4 * Math.PI * (n + 1) * th * th) };
});
export function polytrope(n) {
  n = Math.min(4.5, Math.max(0, n));
  let i = 0;
  while (i < LE_TAB.length - 2 && LE_TAB[i + 1].n <= n) i++;
  const a = LE_TAB[i], b = LE_TAB[i + 1];
  const t = (n - a.n) / (b.n - a.n);
  return {
    n,
    D: Math.exp(Math.log(a.D) * (1 - t) + Math.log(b.D) * t),
    W: Math.exp(Math.log(a.W) * (1 - t) + Math.log(b.W) * t),
    alpha: 3 / (5 - Math.min(n, 4.5)),
  };
}

// Polytropic index that a gas-pressure supported star has: fully convective (n=1.5)
// below ~0.35 Msun, radiative (n=3, Eddington standard model) above ~1.5 Msun.
export function gasIndex(M) {
  const lm = Math.log10(M / C.Msun);
  const t = Math.min(1, Math.max(0, (lm + 0.46) / 0.64));
  return 1.5 + 1.5 * t;
}

// ---------- Structure at given (M, R, T, comp) ----------
export function structure(M, R, T, cs, allowNeutrons = true) {
  const rhoMean = M / (4 / 3 * Math.PI * R ** 3);
  let n = 1.5, poly, rhoC, Pc, cold, th;
  const nGas = gasIndex(M);
  for (let it = 0; it < 24; it++) {
    poly = polytrope(n);
    rhoC = poly.D * rhoMean;
    Pc = poly.W * C.G * M * M / R ** 4;
    cold = coldPressure(rhoC, cs, allowNeutrons);
    th = thermalPressure(rhoC, T, cs);
    const Ptot = cold.total + th.total;
    let nNew;
    if (cold.total <= 0 && th.ion + th.electron < 1e-9 * Pc) {
      nNew = 0; // a cold solid (or loose aggregate) with no gas: uniform density
    } else {
      const gCold = cold.total > 0 ? coldGamma(rhoC, cs, allowNeutrons) : 5 / 3;
      const gGas = 1 + 1 / nGas;
      const gamma = (cold.total * gCold + (th.ion + th.electron) * gGas + th.rad * (4 / 3)) / Ptot;
      nNew = Math.min(4.5, Math.max(0, 1 / Math.max(gamma - 1, 1 / 4.5)));
    }
    if (Math.abs(nNew - n) < 1e-3) { n = nNew; break; }
    n = 0.5 * n + 0.5 * nNew;
  }
  poly = polytrope(n);
  rhoC = poly.D * rhoMean;
  Pc = poly.W * C.G * M * M / R ** 4;
  cold = coldPressure(rhoC, cs, allowNeutrons);
  th = thermalPressure(rhoC, T, cs);
  return {
    n, poly, rhoMean, rhoC, Pc, cold, th,
    Ptot: cold.total + th.total,
    gammaCold: coldGamma(rhoC, cs, allowNeutrons),
  };
}

// Temperature that hydrostatic equilibrium requires at radius R (or null if cold
// pressure alone already exceeds what gravity needs).
export function requiredT(M, R, cs, allowNeutrons = true) {
  const f = (T) => { const s = structure(M, R, T, cs, allowNeutrons); return Math.log(s.Ptot / s.Pc); };
  if (f(T_FLOOR) >= 0) return null;
  let lo = Math.log(T_FLOOR), hi = Math.log(1e13);
  if (f(Math.exp(hi)) < 0) return Math.exp(hi);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(Math.exp(mid)) < 0) lo = mid; else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

// Adiabatic exponent of the thermal part (Gamma3 - 1).
function gamma3m1(th) {
  const gas = th.ion + th.electron;
  const tot = gas + th.rad;
  return tot > 0 ? (2 / 3 * gas + 1 / 3 * th.rad) / tot : 2 / 3;
}

// Find the hydrostatic radius reached from (R0, T0) by adiabatic contraction/expansion.
// Returns { R, T, status } with status: 'ok' | 'blackhole' | 'unbound'.
export function adiabaticEquilibrium(M, R0, T0, cs) {
  const allowN = M <= M_TOV;
  const Rs = 2 * C.G * M / C.c ** 2;
  const s0 = structure(M, R0, T0, cs, allowN);
  const g3 = gamma3m1(s0.th);
  const rhoC0 = s0.rhoC;
  const Tof = (rhoC) => Math.max(T_FLOOR, T0 * Math.pow(rhoC / rhoC0, g3));
  const f = (R) => {
    const rhoMean = M / (4 / 3 * Math.PI * R ** 3);
    // use the polytropic index at R0 for the density guess, then refine via structure()
    const s = structure(M, R, Tof(s0.poly.D * rhoMean), cs, allowN);
    return Math.log(s.Ptot / s.Pc);
  };
  const f0 = f(R0);
  if (Math.abs(f0) < 1e-6) return { R: R0, T: T0, status: 'ok', f0 };
  const step = 0.03;
  let lo, hi; // bracket in log R with f(lo) >= 0 (pressure wins) and f(hi) <= 0 (gravity wins)
  if (f0 > 0) { // over-pressured: expand
    let lr = Math.log(R0), fprev = f0;
    const lmax = Math.log(Math.max(R0 * 1e6, 100 * C.pc));
    while (lr < lmax) {
      const lr2 = lr + step;
      const f2 = f(Math.exp(lr2));
      if (f2 <= 0) { lo = lr; hi = lr2; break; }
      lr = lr2; fprev = f2;
    }
    if (lo === undefined) return { R: R0, T: T0, status: 'unbound' };
  } else { // under-pressured: contract
    let lr = Math.log(R0);
    const lmin = Math.log(BUCHDAHL * Rs);
    while (lr > lmin) {
      const lr2 = Math.max(lmin, lr - step);
      const f2 = f(Math.exp(lr2));
      if (f2 >= 0) { hi = lr; lo = lr2; break; }
      lr = lr2;
    }
    if (lo === undefined) return { R: BUCHDAHL * Rs, T: T0, status: 'blackhole' };
  }
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(Math.exp(mid)) >= 0) lo = mid; else hi = mid;
  }
  const R = Math.exp(0.5 * (lo + hi));
  const s = structure(M, R, T0, cs, allowN);
  const T = Tof(s.rhoC);
  if (R <= BUCHDAHL * Rs * 1.0001) return { R, T, status: 'blackhole' };
  return { R, T, status: 'ok' };
}

// ---------- Nuclear energy generation (W/kg; inputs SI) ----------
// Rates follow Kippenhahn & Weigert (pp, CNO, 3α, C+C, O+O); neon and silicon burning
// use steep threshold laws around their textbook ignition temperatures.
export const REACTIONS = [
  { key: 'pD',  label: 'Deuterium burning (D+p)', fuel: 'D',  Q: 2.63e14 },
  { key: 'pp',  label: 'Hydrogen burning (pp chain)', fuel: 'H', Q: 6.3e14 },
  { key: 'CNO', label: 'Hydrogen burning (CNO cycle)', fuel: 'H', Q: 6.2e14 },
  { key: '3a',  label: 'Helium burning (triple-α)', fuel: 'He', Q: 5.85e13 },
  { key: 'CC',  label: 'Carbon burning', fuel: 'C',  Q: 2.35e13 },
  { key: 'Ne',  label: 'Neon burning',   fuel: 'Ne', Q: 8.3e12 },
  { key: 'OO',  label: 'Oxygen burning', fuel: 'O',  Q: 4.55e13 },
  { key: 'Si',  label: 'Silicon burning', fuel: 'Si', fuels: ['Si', 'Mg'], Q: 3.3e13 },
];
// Products by mass fraction of consumed fuel.
export const PRODUCTS = {
  pD: { He: 1 }, pp: { He: 1 }, CNO: { He: 1 }, '3a': { C: 0.5, O: 0.5 },
  CC: { Ne: 0.6, Mg: 0.4 }, Ne: { O: 0.5, Mg: 0.5 }, OO: { Si: 1 }, Si: { Fe: 1 },
};

export function nuclearRates(rho, T, comp, fe = 1) {
  const r = rho / 1000; // g/cm^3
  const T9 = T / 1e9;
  const out = {};
  if (T9 < 1e-4) { for (const rx of REACTIONS) out[rx.key] = 0; return out; }
  const T913 = Math.cbrt(T9), T923 = T913 * T913;
  const X = comp.H || 0, XD = comp.D || 0, Y = comp.He || 0, XC = comp.C || 0, XO = comp.O || 0,
    XNe = comp.Ne || 0, XSi = comp.Si || 0, XMg = comp.Mg || 0;
  // Above ~7e9 K photodisintegration wins over fusion (nuclear statistical equilibrium).
  // ...and once electrons have been captured there are no nuclei left to fuse.
  const cutoff = Math.exp(-Math.pow(T9 / 5, 6)) * fe * fe;
  const e = (v) => (isFinite(v) && v > 0 ? v * 1e-4 * cutoff : 0); // erg/g/s -> W/kg
  out.pD = e(5.4e21 * r * X * XD / T923 * Math.exp(-3.72 / T913));
  out.pp = e(2.57e4 * r * X * X / T923 * Math.exp(-3.381 / T913) *
    (1 + 0.123 * T913 + 1.09 * T923 + 0.938 * T9));
  out.CNO = e(8.24e25 * r * X * (XC + XO) / T923 * Math.exp(-15.231 / T913 - (T9 / 0.8) ** 2));
  out['3a'] = e(5.09e11 * r * r * Y ** 3 / T9 ** 3 * Math.exp(-4.4027 / T9));
  const T9a = T9 / (1 + 0.0396 * T9);
  out.CC = e(1.86e43 * r * XC * XC * Math.pow(T9a, 5 / 6) / Math.pow(T9, 1.5) *
    Math.exp(-84.165 / Math.cbrt(T9a) - 2.12e-3 * T9 ** 3));
  const T9b = T9 / (1 + 0.067 * T9);
  out.OO = e(2.14e53 * r * XO * XO * Math.pow(T9b, 2 / 3) / Math.pow(T9, 1.5) *
    Math.exp(-135.93 / Math.cbrt(T9b) - 0.629 * Math.pow(T9b, 2 / 3) - 0.445 * Math.pow(T9b, 4 / 3) + 0.0103 * T9 * T9));
  out.Ne = e(1e7 * XNe * (r / 1e6) * Math.min(1e12, Math.pow(T9 / 1.3, 40)));
  out.Si = e(2e8 * (XSi + XMg) * (r / 1e7) * Math.min(1e12, Math.pow(T9 / 3.0, 40)));
  return out;
}

// Pair-neutrino losses (W/kg).
export function neutrinoLoss(rho, T) {
  const T9 = T / 1e9, r = rho / 1000;
  if (T9 < 0.05) return 0;
  const e1 = 4.9e18 * T9 ** 9 * Math.exp(-11.86 / T9) / r;
  const e2 = 4.45e15 * T9 ** 9 / r;
  const w = Math.min(1, Math.max(0, (T9 - 2) / 1));
  return ((1 - w) * e1 + w * e2) * 1e-4;
}

// Photodisintegration of iron (energy sink, W/kg) and its rate of conversion to helium.
export const Q_PHOTO = 2.1e14;    // J/kg absorbed turning Fe into He
export const Q_PHOTO_HE = 6.8e14; // J/kg absorbed turning He into free nucleons
export function photoDisintegration(rho, T, comp) {
  const T9 = T / 1e9, XFe = comp.Fe || 0, XHe = comp.He || 0;
  if (T9 < 3) return { Fe: 0, He: 0 };
  return {
    Fe: XFe > 0 ? 1e13 * 1e-4 * XFe * Math.min(1e8, Math.pow(T9 / 6, 20)) : 0,
    He: XHe > 0 ? 1e13 * 1e-4 * XHe * Math.min(1e8, Math.pow(T9 / 10, 20)) : 0,
  };
}

// Opacity (m^2/kg): electron scattering + Kramers (free-free, bound-free).
export function opacity(rho, T, cs) {
  const kes = 0.02 * (1 + cs.X);
  const t35 = Math.pow(T, -3.5);
  const kff = 3.68e18 * (1 - cs.Zmet) * (1 + cs.X) * rho * t35;
  const kbf = 4.34e19 * cs.Zmet * (1 + cs.X) * rho * t35;
  // dust below ~1500 K (Kramers is for ionised gas and diverges at low T)
  const kdust = T < 1500 ? Math.min(1, 0.01 * (T / 10) ** 2) : 0;
  return kes + kff + kbf + kdust;
}

// Radiative luminosity from the diffusion estimate L ∝ R T_c^4 / (κ ρ_c), calibrated to the Sun.
let CL = 1, FBURN = 0.1;
export const T_HAYASHI = 3300; // K: coolest photosphere a convective, gas-supported star can have
export function radiativeLuminosity(R, s, cs, M = C.Msun) {
  const kap = opacity(s.rhoC, s.T, cs);
  // diffusion estimate, never more than a black body at the central temperature
  const Ldiff = Math.min(CL * R * s.T ** 4 / (kap * s.rhoC), 4 * Math.PI * R * R * C.sigma * s.T ** 4);
  const fdeg = s.cold.total / Math.max(s.Ptot, 1e-300);
  // Photosphere of a gas-supported body: a convective star cannot be cooler than ~3300 K at
  // the surface (Hayashi limit); cooler, younger objects radiate from a photosphere at a
  // fraction of their central temperature.
  const w = Math.max(0, Math.min(1, 1 - 2 * fdeg));
  const Tph = Math.min(T_HAYASHI, 0.3 * s.T);
  const Lhay = s.T > 30 ? w * 4 * Math.PI * R * R * C.sigma * Tph ** 4 : 0;
  // Mestel cooling: a degenerate core leaks heat through a thin non-degenerate envelope.
  const wd = Math.max(0, Math.min(1, 2 * fdeg - 1));
  const Lmestel = wd * 2e-3 * C.Lsun * (M / C.Msun) * Math.pow(s.T / 1e7, 3.5);
  return Math.max(Ldiff, Lhay, Lmestel);
}

// Smallest-radius cold (T = T_FLOOR) equilibrium below Rmax, or null if the object would
// fall inside the GR limit first.
export function coldBranchBelow(M, Rmax, cs) {
  const allowN = M <= M_TOV;
  const Rs = 2 * C.G * M / C.c ** 2;
  const f = (R) => { const s = structure(M, R, T_FLOOR, cs, allowN); return Math.log(Math.max(s.Ptot, 1e-300) / s.Pc); };
  let lr = Math.log(Rmax);
  const lmin = Math.log(BUCHDAHL * Rs);
  if (f(Rmax) >= 0) { // already supported: walk inward while still supported, then outward root
    while (lr > lmin && f(Math.exp(lr - 0.05)) >= 0) lr -= 0.05;
    return Math.exp(lr);
  }
  let hi = lr, lo = null;
  while (lr > lmin) {
    const lr2 = Math.max(lmin, lr - 0.05);
    if (f(Math.exp(lr2)) >= 0) { lo = lr2; hi = lr; break; }
    lr = lr2;
  }
  if (lo === null) return null;
  for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (f(Math.exp(mid)) >= 0) lo = mid; else hi = mid; }
  return Math.exp(0.5 * (lo + hi));
}

// Temperature at which thermal pressure equals `ratio` times the cold pressure at density rho.
export function temperatureForPressureRatio(rho, cs, ratio) {
  const target = ratio * coldPressure(rho, cs).total;
  if (target <= 0) return T_FLOOR;
  let lo = Math.log(T_FLOOR), hi = Math.log(1e13);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (thermalPressure(rho, Math.exp(mid), cs).total < target) lo = mid; else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}
// Mass fraction of the star that takes part in core burning: everything for a fully
// convective star (n = 1.5), about a tenth for a radiative one (n >= 2.2).
export function coreFraction(n) { return 1 - 0.9 * Math.min(1, Math.max(0, (n - 1.5) / 0.7)); }
export function burnFraction() { return FBURN; }

export function calibrate() {
  const cs = compStats(normalizeComp(PRESETS.solar.comp));
  const T = requiredT(C.Msun, C.Rsun, cs);
  const s = structure(C.Msun, C.Rsun, T, cs);
  s.T = T;
  CL = 1; FBURN = 1;
  CL = C.Lsun / (opacity(s.rhoC, T, cs) ** -1 * C.Rsun * T ** 4 / s.rhoC);
  const rates = nuclearRates(s.rhoC, T, normalizeComp(PRESETS.solar.comp));
  const eps = rates.pp + rates.CNO;
  FBURN = C.Lsun / (eps * C.Msun);
  return { Tc: T, rhoC: s.rhoC, Pc: s.Pc, n: s.n, CL, FBURN };
}
export const CALIB = calibrate();

// Black-hole numbers.
export function blackHole(M) {
  const Rs = 2 * C.G * M / C.c ** 2;
  const TH = C.hbar * C.c ** 3 / (8 * Math.PI * C.G * M * C.k);
  const tEvap = 5120 * Math.PI * C.G ** 2 * M ** 3 / (C.hbar * C.c ** 4);
  return { Rs, TH, tEvap, rhoMean: M / (4 / 3 * Math.PI * Rs ** 3) };
}
