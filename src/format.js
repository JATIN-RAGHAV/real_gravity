import { C } from './physics.js';

const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function sup(n) { return String(n).split('').map(c => SUP[c] || c).join(''); }

export function sci(x, digits = 2) {
  if (!isFinite(x)) return x > 0 ? '∞' : '—';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 4) return (+x.toPrecision(digits + 1)).toString();
  const m = x / Math.pow(10, e);
  return `${m.toFixed(digits)}×10${sup(e)}`;
}

export function fmtMass(M) {
  if (M < 1e-3 * C.Mearth) return `${sci(M)} kg`;
  if (M < 30 * C.Mearth) return `${(+(M / C.Mearth).toPrecision(3))} M⊕`;
  if (M < 0.012 * C.Msun) return `${(+(M / C.Mjup).toPrecision(3))} M♃`;
  return `${(+(M / C.Msun).toPrecision(3))} M☉`;
}
export function fmtMassLong(M) {
  const a = fmtMass(M);
  return a.endsWith('kg') ? a : `${a} · ${sci(M)} kg`;
}
export function fmtLen(R) {
  if (R < 1e3) return `${sci(R)} m`;
  if (R < 0.05 * C.Rsun) return `${sci(R / 1e3)} km`;
  if (R < 1000 * C.Rsun) return `${(+(R / C.Rsun).toPrecision(3))} R☉`;
  if (R < 0.5 * C.pc) return `${(+(R / C.AU).toPrecision(3))} AU`;
  return `${(+(R / C.pc).toPrecision(3))} pc`;
}
export function fmtLenCompare(R) {
  if (R < 1e3) return '';
  if (R < 3 * C.Rearth) return `${(R / C.Rearth).toPrecision(2)} R⊕`;
  if (R < 0.2 * C.Rsun) return `${(R / C.Rjup).toPrecision(2)} R♃`;
  return '';
}
export function fmtTime(s) {
  if (!isFinite(s)) return '∞';
  if (s < 1e-3) return `${sci(s)} s`;
  if (s < 60) return `${(+s.toPrecision(2))} s`;
  if (s < 3600) return `${(+(s / 60).toPrecision(2))} min`;
  if (s < 2 * 86400) return `${(+(s / 3600).toPrecision(2))} h`;
  if (s < C.yr) return `${(+(s / 86400).toPrecision(2))} d`;
  const y = s / C.yr;
  if (y < 1e3) return `${(+y.toPrecision(3))} yr`;
  if (y < 1e6) return `${(+(y / 1e3).toPrecision(3))} kyr`;
  if (y < 1e9) return `${(+(y / 1e6).toPrecision(3))} Myr`;
  if (y < 1e12) return `${(+(y / 1e9).toPrecision(3))} Gyr`;
  return `${sci(y)} yr`;
}
export function fmtTemp(T) {
  if (T < 3) return '—';
  if (T < 1e4) return `${Math.round(T)} K`;
  return `${sci(T)} K`;
}
export function fmtLum(L) {
  if (L < 1e-30) return '—';
  return `${sci(L / C.Lsun)} L☉`;
}
export function pct(x) { return `${(100 * x).toFixed(x < 0.0095 ? 2 : 0)}%`; }
