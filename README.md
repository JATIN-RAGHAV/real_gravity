# Gravity Forge

A browser game about what gravity does to a ball of matter. Set the mass,
the mean density and the composition; the object gets whatever internal
temperature hydrostatic balance demands, and then time runs. Depending on
what you built it becomes a rock, a planet, a brown dwarf, a star that
climbs the burning chain from hydrogen to silicon, a white dwarf, a neutron
star, or a black hole. If you squeeze iron hard enough it never fuses: it
collapses.

Everything runs in the browser. There is no server-side computation.

## Run it

```
npm install
npm start          # dev server, opens http://localhost:5173
```

Without Node, the source also runs from any static file server:

```
python3 -m http.server 8765   # then open http://127.0.0.1:8765/
```

## Build and bundle

```
npm run build      # static site in dist/ (deploy to any static host)
npm run preview    # serve dist/ locally
npm run bundle     # one self-contained file: bundle/index.html
npm test           # physics sanity checks (node)
```

`bundle/index.html` has all CSS and JavaScript inlined; it opens straight
from disk by double-clicking it. Only the fonts come from Google Fonts,
and the page falls back to system fonts offline.

## Deploy on Vercel

Import the repository on vercel.com or run `npx vercel`. `vercel.json`
tells it to build with `npm run build` and serve `dist/`; no functions,
no environment variables.

Scenarios can be linked directly: `#s1` to `#s9` after the URL (see the
"Try one" list).

## Layout

- `src/physics.js`: constants, equation of state, polytropic structure,
  nuclear rates, opacities, luminosity, GR limits.
- `src/sim.js`: object state, god-mode setters, time stepping,
  classification, events.
- `src/render.js`: WebGL renderer (procedural sphere shading, black-hole
  lensing) with a 2D overlay for effects.
- `src/shader.js`: the GLSL fragment shader for every object kind.
- `src/render2d.js`: 2D fallback renderer and the effect drawing.
- `src/ui.js`: readouts, pressure-support bar, density-temperature map,
  composition controls.
- `src/main.js`: wiring, animation loop, scenarios.
- `test/sanity.mjs`: node checks, run with `npm test`.
- `vite.config.js`, `vite.bundle.config.js`, `vercel.json`: build and
  deployment configuration.

## The model

One zone plus a burning core, in SI units.

- **Structure.** Lane-Emden polytropes. The index comes from the effective
  adiabatic exponent of the total pressure (cold part from its numerical
  gamma, gas part from a convective-to-radiative ramp with mass, radiation
  at 4/3). Central density and pressure follow from mass and radius. A body
  whose gravity is negligible against its bulk modulus is uniform.
- **Cold pressure.** Exact zero-temperature electron Fermi gas
  (relativistic), with an n_e^(4/3) lattice term calibrated so each
  material is at zero pressure at its laboratory density, and a
  Birch-Murnaghan branch with measured bulk moduli for mild compression.
  Electron capture above a composition-dependent density removes electron
  support and feeds a degenerate neutron gas. The Chandrasekhar mass
  (about 1.45 solar masses) emerges from this; it is not coded in.
- **Thermal pressure.** Ideal ions (only for the vapour fraction: solids
  have none), thermal electrons suppressed by degeneracy, radiation.
- **Energy.** Radiative diffusion `L ~ R T_c^4 / (kappa rho_c)` calibrated
  to the Sun, capped by a black body at the central temperature; a
  photospheric floor (Hayashi limit at 3300 K for convective stars);
  Mestel cooling for degenerate objects; pair-neutrino losses;
  photodisintegration of iron and helium as sinks. Fusion: D+p, pp, CNO,
  triple-alpha, C+C, O+O from Kippenhahn and Weigert; Ne and Si burning
  as steep threshold laws. The burn fraction is calibrated so the Sun has
  one solar luminosity at one solar radius.
- **Time stepping.** Cool (or heat) at fixed radius, then re-equilibrate
  adiabatically. That is the main-sequence thermostat. Contraction is
  charged at least the free-fall time. When the thermal timescale drops
  within ten free-fall times at T > 1e9 K, or when no equilibrium exists,
  the object collapses: the envelope (if any) is ejected as a supernova,
  the core lands on the neutron-star branch if below the TOV limit
  (2.3 solar masses) or becomes a black hole.
- **General relativity** appears only as limits: no static solution inside
  1.41 Schwarzschild radii (the causal bound; Buchdahl's 9/8 is the
  absolute one), and the TOV mass.

### Known approximations

- Planets come out 10 to 40 percent too large (the Thomas-Fermi branch is
  stiff).
- No red giants (shell burning needs more than one zone), no rotation,
  magnetic fields, winds, mass transfer or pair instability.
- Main-sequence lifetimes are right to a factor of about two; the Sun
  lasts 5.6 Gyr here.
- Gas-cloud dispersal uses a 10 K ambient temperature as the Jeans
  criterion.
