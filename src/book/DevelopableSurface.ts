/**
 * DevelopableSurface.ts — pure-math model for the inextensible
 * (developable-surface) page deformation. See docs/prd-page-model.md.
 *
 * This module is intentionally Three.js-free so it can be unit-tested
 * cheaply and reused by both the renderer (Book.ts) and the offline
 * trajectory predictor (harness/src/bootstrap.ts).
 *
 * Inspiration (cite, do not copy): do Carmo, *Differential Geometry of
 * Curves and Surfaces*, §3.5 (developables); Solomon et al. 2012,
 * "Flexible developable surfaces" (discrete formulation).
 *
 * The continuum model is a Kirchhoff–Love thin-shell with membrane
 * stiffness → ∞ (no in-plane stretch, paper is essentially inextensible)
 * and finite bending stiffness `D`. Locally the deformation is decomposed
 * into:
 *
 *   1. A rigid rotation of the entire flap by `dihedral` around the
 *      (tilted) crease axis. Owned by CreaseGeometry.ts.
 *   2. A cylindrical curl on top, with axis parallel to the crease
 *      direction and constant radius `R` across the flap (uniform-R is
 *      the v1 simplification — see PRD open question Q2).
 *
 * The curled, lifted position of a flap point at arc-length `s` away from
 * the crease and offset `u` along the crease is
 *
 *   x(s, u) = origin + R·sin(s/R)·n̂' + R·(1 − cos(s/R))·b̂' + u·k̂
 *
 * where `n̂'` is the (rotated) page-tangent direction, `b̂'` is the
 * (rotated) page-normal direction, and `k̂` is the crease direction.
 * `R = ∞` recovers the rigid-flat-flap limit.
 *
 * Design decisions encoded here (PRD open questions):
 *   Q1: curl axis tilts with creaseDir (physically defensible).
 *   Q2: uniform R across the flap (true cylinder, simpler v1).
 *   Q3: crease exemption is a UV-space mask (~1% of pageWidth) — owned by
 *       the shader; this module only exposes the default value as a
 *       constant.
 *   Q5: D is per-page-stock; two presets shipped (interior, cover).
 */

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** Default crease-exemption half-width in page-local units (≈1% of pageWidth=1). */
export const DEFAULT_EXEMPTION_HALF_WIDTH = 0.01;

/** Whether the ?dev-surface=1 URL flag is set (developable-surface model on). */
export function developableEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('dev-surface') === '1';
  } catch {
    return false;
  }
}

/** Page-stock material parameters (FR-P3). */
export interface PageStock {
  /** Human-readable name. */
  name: string;
  /** Bending stiffness D in µN·m. Larger ⇒ stiffer ⇒ larger curl radius. */
  D: number;
  /** Tightest curl radius the page allows, in page-local units (pageWidth = 1). */
  R_min: number;
}

/**
 * Default interior-page stock: lightweight book paper. Lower D ⇒ tighter
 * curl, more visible flutter. Roughly maps to ~80 gsm book paper at the
 * lower end of the table in `prd-page-model.md`.
 */
export const INTERIOR_STOCK: PageStock = {
  name: 'interior',
  D: 5,        // µN·m, low end of typical book paper
  R_min: 0.25, // ~25% of pageWidth — visibly curled
};

/**
 * Default cover stock: heavier cardstock. Higher D ⇒ looser curl, settles
 * faster, less flutter. Roughly maps to ~250 gsm cover paper at the upper
 * end of the table in `prd-page-model.md`.
 */
export const COVER_STOCK: PageStock = {
  name: 'cover',
  D: 100,      // µN·m, ~20× interior — three-decade range per PRD
  R_min: 0.9,  // ~90% of pageWidth — gentle curl
};

/** A reasonably large radius the renderer treats as "essentially flat". */
export const FLAT_RADIUS = 1e6;

/**
 * Derive a curl radius `R` from bending stiffness `D` and the static
 * gravity-load moment per unit width.
 *
 * For paper modeled as a Kirchhoff–Love thin-shell, the equilibrium
 * curvature κ = M/D where M is the local bending moment. The static
 * gravity moment of a free flap of length `s` and surface mass `μ` is
 * M ≈ ½ μ g s². Inverting:
 *
 *     R = D / (gravityMoment)
 *
 * This is a rough phenomenological mapping for v1 — *not* a structural
 * FEA. Its only job is to make heavy stocks curl less than light ones
 * under the same drag (FR-P3) and to give the settle ODE a physically
 * scaled R (FR-P4 forward-compat).
 *
 * The result is clamped to [stock.R_min, FLAT_RADIUS] so the renderer
 * never sees a degenerate or negative radius.
 */
export function radiusFromBendingStiffness(
  D: number,
  gravityMoment: number,
  stock: PageStock = INTERIOR_STOCK,
): number {
  if (gravityMoment <= 0 || !Number.isFinite(gravityMoment)) return FLAT_RADIUS;
  if (!Number.isFinite(D) || D <= 0) return stock.R_min;
  const raw = D / gravityMoment;
  if (raw < stock.R_min) return stock.R_min;
  if (raw > FLAT_RADIUS) return FLAT_RADIUS;
  return raw;
}

/**
 * Cylindrical-curl world position for a flap point at (s, u) relative to
 * the crease, given the rigid dihedral rotation around the crease axis.
 *
 * @param s          Arc-length distance from the crease (≥ 0). At s=0, the
 *                   point lies on the crease and is unchanged by the curl
 *                   (only by the rigid rotation).
 * @param u          Offset along the crease direction (signed).
 * @param R          Curl radius (use FLAT_RADIUS for "no curl"). Larger ⇒
 *                   straighter; smaller ⇒ tighter cylinder.
 * @param dihedral   Rigid rotation angle around the crease axis (radians,
 *                   in [0, π] for a forward turn).
 * @param creaseAxis Unit vector along the crease in the page plane (z=0).
 *                   This is `k̂`.
 * @param origin     Crease-axis origin in 3D (page-local; z=0).
 *
 * The "rest" tangent into the flap, n̂, is the in-plane unit perpendicular
 * to creaseAxis pointing into the flap. `cornerDir` (sign of n̂) is taken
 * from the caller's convention: n̂ = (-creaseAxis.y, creaseAxis.x, 0)
 * by default, but the caller may flip the sign if their flap sits on the
 * other side of the crease.
 *
 * The PRD formula:
 *     x(s,u) = origin + R·sin(s/R)·n̂' + R·(1−cos(s/R))·b̂' + u·k̂
 * with n̂' = rigid_rot(n̂, dihedral, k̂), b̂' = rigid_rot(ẑ, dihedral, k̂).
 */
export function cylindricalCurlPos(
  s: number,
  u: number,
  R: number,
  dihedral: number,
  creaseAxis: Vec2,
  origin: Vec3 = { x: 0, y: 0, z: 0 },
  flapSign: 1 | -1 = 1,
): Vec3 {
  // In-plane normal to crease, pointing into the flap. For the canonical
  // book orientation (k̂ = +ŷ along the spine, flap on the +x side) this
  // is +x̂; flapSign = -1 mirrors to the other side of the crease.
  const nx = creaseAxis.y * flapSign;
  const ny = -creaseAxis.x * flapSign;
  // n̂ = (nx, ny, 0); ẑ = (0, 0, 1). Rotate both by `dihedral` around k̂.
  // Rodrigues with k̂ in the xy-plane: for a vector v,
  //   v' = v·cos + (k̂×v)·sin + k̂(k̂·v)(1−cos)
  const c = Math.cos(dihedral);
  const si = Math.sin(dihedral);
  const kx = creaseAxis.x;
  const ky = creaseAxis.y;
  const kz = 0;

  // n̂' = rotate (nx, ny, 0)
  // k̂·n̂ = kx*nx + ky*ny  (zero by construction since n̂ ⊥ k̂ in-plane)
  const kDotN = kx * nx + ky * ny;
  // k̂ × n̂ = (ky·0 − kz·ny, kz·nx − kx·0, kx·ny − ky·nx) = (0, 0, kx*ny − ky*nx)
  const knX = ky * 0 - kz * ny;
  const knY = kz * nx - kx * 0;
  const knZ = kx * ny - ky * nx;
  const npx = nx * c + knX * si + kx * kDotN * (1 - c);
  const npy = ny * c + knY * si + ky * kDotN * (1 - c);
  const npz = 0 * c + knZ * si + kz * kDotN * (1 - c);

  // b̂' = rotate ẑ = (0,0,1)
  // k̂·ẑ = 0; k̂ × ẑ = (ky·1 − 0, 0 − kx·1, 0) = (ky, -kx, 0)
  const bx = ky * si;
  const by = -kx * si;
  const bz = c;

  // Curl arc on the cylinder. Use the small-R safe formulation:
  //   sinR = R*sin(s/R)         (→ s as R→∞)
  //   verR = R*(1 - cos(s/R))   (→ 0 as R→∞)
  // Guard against R = 0 / non-finite.
  const safeR = (Number.isFinite(R) && R > 1e-9) ? R : FLAT_RADIUS;
  const theta = s / safeR;
  const sinR = safeR * Math.sin(theta);
  const verR = safeR * (1 - Math.cos(theta));

  return {
    x: origin.x + sinR * npx + verR * bx + u * kx,
    y: origin.y + sinR * npy + verR * by + u * ky,
    z: origin.z + sinR * npz + verR * bz + u * kz,
  };
}

/**
 * Geodesic distance between two points specified in *rest* page-local 2D
 * coordinates `(s, u)` from the crease. On a developable cylinder of
 * radius R the surface unrolls flat without distortion, so the geodesic
 * distance equals the rest Euclidean distance:
 *
 *     d_geo((s1,u1), (s2,u2)) = √((s1−s2)² + (u1−u2)²)
 *
 * (`R` is accepted for API symmetry / future-proofing; for a uniform-R
 * cylinder it does not enter the formula. The point of the function is
 * to make the inextensibility invariant assertion easy to write.)
 */
export function geodesicDistance(p1: Vec2, p2: Vec2, _R: number = FLAT_RADIUS): number {
  const ds = p1.x - p2.x;
  const du = p1.y - p2.y;
  return Math.hypot(ds, du);
}

/**
 * Straight-line (chord) distance in 3D space between two points.
 * Used by the FR-P1 invariant test: on a developable surface the chord
 * is shorter than the geodesic but approaches it as the bend angle
 * straddled by the chord shrinks. The harness samples enough fiducials
 * that adjacent-fiducial chords are good geodesic approximations.
 */
export function chordDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
