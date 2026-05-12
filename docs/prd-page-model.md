# PRD: Page model — inextensibility (developable surface)

Status: Draft
Owner: Page-turn renderer
Scope: Foundational geometric constraint that *all* page deformations
(static drag, timed turn, fan turn, settle) must satisfy. Companion to
`prd-settle-physics.md`.

## Background — what's wrong now

The inline `FLIP_VERT` shader in `src/book/Book.ts` rotates each flap
vertex by an angle that depends on its own `t`-coordinate (normalized
distance from the crease):

```
φ(t) = uAngle + 0.4 · t · sin(2 · uAngle)
```

This is a *non-rigid, per-vertex* rotation. Vertices at small `t` rotate by
nearly `uAngle`; vertices near the free edge (`t = 1`) rotate by
`uAngle + 0.4·sin(2·uAngle)`. The mesh topology and per-vertex world
positions are well-defined, but **geodesic distances along the page surface
are not preserved**. A pair of points 5 mm apart on the rest sheet can wind
up 4.7 mm or 5.4 mm apart mid-turn, depending on where they sit relative to
the crease.

A user, looking at a mid-drag screenshot, characterized this as the page
"stretching as a thin elastic surface." That is exactly right
mathematically. Paper, however, has near-zero membrane strain — it can be
bent essentially freely, but stretched essentially not at all.

## The correct constraint

Paper is well-modeled as a **developable surface**: a smooth surface with
Gaussian curvature `K = 0` everywhere. Developable surfaces are exactly
those that can be unrolled flat without stretching, and they are
characterized (in the smooth case) as planes, generalized cylinders,
generalized cones, or tangent-developable surfaces. Inspired-by (cite, do
not copy): do Carmo, *Differential Geometry of Curves and Surfaces*, §3.5
(developables); Solomon et al. 2012, "Flexible developable surfaces," for
the discrete formulation.

The continuum mechanics underpinning is the **Kirchhoff–Love thin-shell
model**, with the limit:

- Membrane stiffness `→ ∞` — the sheet resists in-plane stretch
  essentially absolutely.
- Bending stiffness `D` finite and moderate — the sheet resists, but
  permits, out-of-plane curvature.

For paper:

```
D = E · t³ / [12 · (1 − ν²)]
```

with material ranges:

| Parameter | Symbol | Range                | Notes                    |
|-----------|--------|----------------------|--------------------------|
| Young's modulus  | `E` | 2–10 GPa     | machine-direction; lower across fiber |
| Thickness        | `t` | 0.05–0.30 mm | newsprint → cardstock                 |
| Poisson ratio    | `ν` | ≈ 0.3        | typical for paper                     |
| Bending stiffness | `D` | ~ 0.2 µN·m to ~ 200 µN·m | spans 3 decades        |

This range is what makes a feather-light onion-skin Bible page curl into a
tight cylinder under its own weight, while a piece of cardstock barely sags
— the same equations, different `D`.

## Practical implication for the shader

The current `sin(2φ)` envelope is a perceptual hack: it adds lag at the
free edge to *suggest* gravity-bend, but pays for it in membrane strain.
Replace the per-vertex angle with a true rigid-body + cylindrical-curl
decomposition:

1. **Rigid rotation** of the entire flap region by `uDihedral` around the
   (tilted) crease axis. This is what `CreaseGeometry.ts` already pins —
   keep it.
2. **Cylindrical curl** layered on top: a developable cylinder whose axis
   is *parallel* to the crease and whose radius `R` is constant across the
   flap, set by the bending-stiffness parameter.

Mathematically, parameterize the flap in (s, u) coordinates where `s` is
arc-length away from the crease and `u` is along the crease. Rest position
is `x₀(s, u) = origin + s·n̂ + u·k̂` (with `n̂ ⊥ k̂` in the page plane).
The curled, lifted position is

```
x(s, u) = origin + R·sin(s/R)·n̂' + R·(1 − cos(s/R))·b̂' + u·k̂
n̂' = rigid_rot(n̂, uDihedral, k̂)
b̂' = rigid_rot(ẑ,  uDihedral, k̂)
```

This is an isometric embedding of the rest sheet — every infinitesimal
patch preserves area and every geodesic preserves length. `R = ∞`
recovers the rigid-flat-flap limit; small `R` produces a tight curl. `R`
itself is driven by the static gravity moment vs the bending stiffness
`D`, and during settle by the aerodynamic puff term defined in
`prd-settle-physics.md`.

## Why "thin elastic surface" still has merit

Inextensible does not mean rigid. The bending elasticity is what gives
paper its characteristic *curl-and-relax* behavior, and is exactly the
degree of freedom the settle physics needs. Different paper weights (gsm)
map to different `D` and therefore to different curl radii and different
relaxation timescales. Concretely:

- A heavier "cover" stock should curl less under the same gravity (larger
  `R`), and settle faster (larger `D` ⇒ stiffer restoring torque per
  unit curvature).
- A lighter "interior" page should curl more, settle slower, and flutter
  more visibly under the aerodynamic puff.

This connects directly to the aerodynamic settle PRD: the `b̈` ODE
proposed there (`b̈ = ω²·(b₀ − b) − Db·ḃ + κ·φ̇²`) becomes, under this
model, an ODE on the *cylindrical curl curvature* `1/R`, with `ω²` and
`Db` no longer free art knobs but functions of `D` and the flap
dimensions. The puff still excites curl; the puff just lives on the
developable manifold instead of an arbitrary per-vertex displacement
field.

## Functional requirements

**FR-P1. Inextensibility invariant.** At any moment during any
animation (drag, timed turn, fan turn, settle), for every pair of
fiducial markers on the lifted flap, the geodesic distance between them
on the rendered page surface shall equal their rest-configuration
geodesic distance to within 1.0% (tolerance scaled by `pageWidth`).

**FR-P2. Developable parameterization.** The flap deformation shall be
expressible as the composition of (a) a rigid rotation around the
(tilted) crease axis, and (b) a cylindrical isometry parameterized by a
single curvature scalar `1/R`. No additional per-vertex degrees of
freedom shall be introduced into the static bend.

**FR-P3. Bending-stiffness parameter.** A material parameter `D` (or
equivalently `R_min`, the tightest curl radius the page allows) shall be
exposed as a per-page-stock setting. Out of the box, two stocks are
defined: "interior" (lower `D`) and "cover" (higher `D`). Cover pages
shall visibly curl less than interior pages under identical drag input.

**FR-P4. Continuity with settle PRD.** All time-varying state defined in
`prd-settle-physics.md` (`φ`, `b`, puff, tangent drift) shall act on the
developable-surface manifold. The settle integrator shall not introduce
membrane strain.

**FR-P5. Crease region.** A small neighborhood of the crease (width
configurable, default ~ 1 mm in page-local units) is exempt from the
zero-strain constraint, since real paper folds plastically there. This
exemption is bounded and documented; it is not a license for general
non-developable deformation away from the crease.

## Acceptance criteria / Validation

The 35-fiducial trajectory dataset (`harness/baselines/`, 5×7 grid at
known UVs in `src/textures/atlas.ts`) is the natural test bed:

1. **Pairwise geodesic invariant.** Extend the harness runner to compute,
   per frame, the pairwise straight-line distance between fiducials in
   page-local 3D space (which equals geodesic distance on a developable
   surface up to the bend angle they straddle, in the small-patch limit).
   The frame-to-rest ratio shall lie in `[0.99, 1.01]` for all pairs not
   straddling the crease exemption zone (FR-P5).
2. **Curl-radius regression.** New scenarios `static-cover-stock` and
   `static-interior-stock` apply identical drag to two materials; assert
   the measured free-edge displacement differs by the ratio predicted by
   `D_cover / D_interior`.
3. **Visual regression.** Capture the post-change `sin2phi → developable`
   diff into `harness/baselines/developable/` per the existing baseline
   workflow in `harness/baselines/README.md`. Document the per-fiducial
   trajectory delta (the change is expected to be > the inter-frame
   noise floor, so a numeric diff is informative not pass/fail).

## Non-goals

- Plastic deformation (creases that persist after release). The crease
  exemption FR-P5 is a static modeling allowance, not a plasticity model.
- Tear / puncture mechanics.
- Anisotropic paper (machine vs cross direction stiffness). `D` is
  scalar in v1.
- Self-collision of the page with itself (e.g., a curl tight enough to
  touch its own back face). The cylindrical model can produce such
  configurations but we do not resolve them.
- Multi-layer laminates, folded inserts, etc.

## Open questions

1. The `CreaseGeometry.ts` model already defines a *tilted* crease axis.
   Cylindrical curl whose axis is parallel to the crease is unambiguous
   in the spine-aligned case but needs care when `creaseDir` tilts —
   does the curl axis tilt with it (most physically defensible) or stay
   spine-aligned (simpler)?
2. Should `R` be uniform across the flap (true cylinder) or allowed to
   vary along the crease direction (still developable as a generalized
   cylinder, but more parameters)? Uniform is the proposed v1.
3. How is the crease-exemption zone (FR-P5) implemented — a UV-space
   mask in the shader, or a geometric blend in the parameterization?
4. Does the popup diorama (`POPUP_SPREAD = 7`) need its own
   developable model, or are popup folds rigid?
5. Is `D` exposed as a per-page (per-spread) parameter, or globally per
   book? Per-page enables a heavier cover than interior, which is
   physically realistic and visually desirable.

## Implementation hints (non-binding)

- **`src/book/Book.ts`** — replace the `FLIP_VERT` formula with the
  cylindrical-curl parameterization. The new shader needs `uCurlRadius`
  (or equivalent) plus the existing crease uniforms.
- **`src/book/CreaseGeometry.ts`** — likely gains a helper that takes a
  drag point and returns `(uDihedral, uCurlRadius)` jointly, replacing
  the current scalar mapping.
- **New `src/book/PageMaterial.ts` (or extend `BookMaterial`)** — owns
  the `D`, `t`, `E`, `ν` parameters per page stock.
- **`src/main.ts`** — no direct change required; the settle integrator
  proposed in `prd-settle-physics.md` continues to operate on `(φ, b)`,
  with `b` reinterpreted as `1/R`.
- The change is large enough that a feature flag is recommended, with
  the `sin2phi` shader path retained until the developable path passes
  the FR-P1 invariant on every baseline scenario.
