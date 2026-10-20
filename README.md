# Gravity Forge

A browser game about what gravity does to a ball of matter. Set the mass, the mean density and
the composition; the object gets whatever internal temperature hydrostatic balance demands, and
then time runs. Depending on what you built it becomes a rock, a planet, a brown dwarf, a star
that climbs the burning chain from hydrogen to silicon, a white dwarf, a neutron star, or a black
hole. If you squeeze iron hard enough it never fuses: it collapses.

No build step. Open `index.html` through any static server, for example:

```
python3 -m http.server 8765
# then open http://127.0.0.1:8765/
```

Scenarios can be linked directly: `index.html#s1` … `#s9` (see the "Try one" list).

## Layout

| Path | Role |
| --- | --- |
| `src/physics.js` | Constants, equation of state, polytropic structure, nuclear rates, opacities, luminosity, GR limits |
| `src/sim.js` | Object state, god-mode setters, time stepping, classification, events |
| `src/render.js` | Canvas drawing (log-scale sizes, lensing for black holes, effects) |
| `src/ui.js` | Readouts, pressure-support bar, ρ–T regime map, composition controls |
| `src/main.js` | Wiring, animation loop, scenarios |
| `test/sanity.mjs` | Node checks: `node test/sanity.mjs` |

## The model

One zone plus a burning core, in SI units.

- **Structure.** Lane–Emden polytropes. The index comes from the effective adiabatic exponent of
  the total pressure (cold part from its numerical γ, gas part from a convective→radiative ramp
  with mass, radiation at 4/3). Central density and pressure follow from mass and radius.
- **Cold pressure.** Exact zero-temperature electron Fermi gas (relativistic), with an
  n_e^(4/3) lattice term calibrated so each material is at zero pressure at its laboratory
  density, and a Birch–Murnaghan branch with measured bulk moduli for mild compression.
  Electron capture above a composition-dependent density removes electron support and feeds a
  degenerate neutron gas. The Chandrasekhar mass (≈1.45 M☉) emerges from this; it is not coded.
- **Thermal pressure.** Ideal ions (only for the vapour fraction: solids have none), thermal
  electrons suppressed by degeneracy, radiation.
- **Energy.** Radiative diffusion `L ∝ R T_c⁴ / (κ ρ_c)` calibrated to the Sun, capped by a black
  body at the central temperature; a photospheric floor (Hayashi limit at 3300 K for convective
  stars); Mestel cooling for degenerate objects; pair-neutrino losses; photodisintegration of
  iron and helium as sinks. Fusion: D+p, pp, CNO, 3α, C+C, O+O from Kippenhahn & Weigert; Ne and
  Si burning as steep threshold laws. The burn fraction is calibrated so the Sun has 1 L☉ at
  1 R☉.
- **Time stepping.** Cool (or heat) at fixed radius, then re-equilibrate adiabatically. That is
  the main-sequence thermostat. Contraction is charged at least the free-fall time. When the
  thermal timescale drops within ten free-fall times at T > 10⁹ K, or when no equilibrium exists,
  the object collapses: the envelope (if any) is ejected as a supernova, the core lands on the
  neutron-star branch if below the TOV limit (2.3 M☉) or becomes a black hole.
- **General relativity** appears only as limits: no static solution inside 1.41 Schwarzschild
  radii (the causal bound; Buchdahl's 9/8 is the absolute one), and the TOV mass.

### Known approximations

- Planets come out 10–40% too large (the Thomas–Fermi branch is stiff).
- No red giants (shell burning needs more than one zone), no rotation, magnetic fields, winds,
  mass transfer or pair instability.
- Main-sequence lifetimes are right to a factor ~2; the Sun lasts 5.6 Gyr here.
- Gas-cloud dispersal uses a 10 K ambient temperature as the Jeans criterion.
