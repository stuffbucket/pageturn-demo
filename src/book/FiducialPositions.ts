/**
 * FiducialPositions.ts — pure-math browser-side mirror of the analytic
 * `fiducialWorldPosition` function in `harness/src/bootstrap.ts`.
 *
 * Why duplicate? The harness module is run inside Playwright's bundled
 * test runner and depends on import paths that don't survive Vite's
 * production tree-shake; rather than refactor the harness ⇆ src boundary
 * mid-diagnostic, we keep two copies and pin them together with a
 * cross-checked unit test in `FiducialPositions.test.ts`.
 *
 * Used by:
 *   • main.ts → emits `fiducial-positions` and `surface-area-sample`
 *               telemetry events at 1 Hz during a turn.
 *   • debug.ts → live FR-P1 area-ratio readout in the HUD.
 *   • long-press-capture.ts → embeds the latest sample in the sidecar JSON.
 *
 * The function returns *book-local* coordinates (after the BOOK_TILT
 * unrolled) — the same convention the harness uses for trajectory
 * baselines, so a sidecar from a long-press capture and a baseline from
 * the harness can be diffed by row index alone.
 *
 * See `docs/diagnostic-2026-05-14.md` for the diagnostic motivation.
 */

import { FIDUCIAL_US, FIDUCIAL_VS } from '../textures/atlas';

/** Must match `BOOK_TILT` in `main.ts` and `harness/src/bootstrap.ts`. */
const BOOK_TILT = 0.76;
/** Must match `pageWidth` / `pageHeight` in `main.ts`. */
const PAGE_WIDTH = 1.0;
const PAGE_HEIGHT = 1.4;
/** Must match `uBendAmount` constant in the inline FLIP_VERT shader. */
const BEND_AMOUNT = 0.4;

export interface Vec3 { x: number; y: number; z: number }

/**
 * Single-fiducial position in world space, mirroring the live shader path.
 *
 * Inputs match `harness/src/bootstrap.ts:fiducialWorldPosition` exactly.
 * If the live shader changes, both copies must change in lockstep.
 */
export function fiducialWorldPosition(
  uAngle: number,
  u: number,
  v: number,
  developable = false,
  curlR = 1e6,
  exempt = 0,
  maxCurlAngle = Math.PI / 3,
): Vec3 {
  const origX = u * PAGE_WIDTH;
  let localX: number;
  let localZ: number;
  if (developable) {
    const d = Math.abs(uAngle);
    const cosD = Math.cos(d);
    const sinD = Math.sin(d);
    const rigidS = Math.min(origX, exempt);
    const effS = Math.max(origX - exempt, 0);
    const safeR = curlR > 1e-4 ? curlR : 1e-4;
    const theta = Math.min(effS / safeR, maxCurlAngle);
    const sCurl = theta * safeR;
    const sExt = Math.max(effS - sCurl, 0);
    const sinR = safeR * Math.sin(theta) + sExt * Math.cos(theta);
    const verR = safeR * (1 - Math.cos(theta)) + sExt * Math.sin(theta);
    localX = (rigidS + sinR) * cosD - verR * sinD;
    localZ = (rigidS + sinR) * sinD + verR * cosD;
  } else {
    const phi = uAngle + BEND_AMOUNT * u * Math.sin(2 * uAngle);
    localX = origX * Math.cos(phi);
    localZ = -origX * Math.sin(phi);
  }
  const localY = (v - 0.5) * PAGE_HEIGHT;
  const c = Math.cos(-BOOK_TILT);
  const s = Math.sin(-BOOK_TILT);
  const worldY = localY * c - localZ * s;
  const worldZ = localY * s + localZ * c;
  return { x: localX, y: worldY, z: worldZ };
}

export interface FiducialSampleOptions {
  uAngle: number;
  developable: boolean;
  curlR: number;
  exempt: number;
}

export interface FiducialSample {
  /** "P_<i>_<j>" id matching the harness convention. */
  id: string;
  i: number;
  j: number;
  /** Page-local UV in [0, 1]. */
  u: number;
  v: number;
  /** Position in book-local world space (post-tilt). */
  pos: Vec3;
}

/** Sample the entire 5x7 fiducial grid for the active turning page. */
export function sampleAllFiducials(opts: FiducialSampleOptions): FiducialSample[] {
  const out: FiducialSample[] = [];
  for (let i = 0; i < FIDUCIAL_US.length; i++) {
    for (let j = 0; j < FIDUCIAL_VS.length; j++) {
      const u = FIDUCIAL_US[i];
      const v = FIDUCIAL_VS[j];
      const pos = fiducialWorldPosition(opts.uAngle, u, v, opts.developable, opts.curlR, opts.exempt);
      out.push({ id: `P_${i}_${j}`, i, j, u, v, pos });
    }
  }
  return out;
}

/**
 * Approximate surface area of the curled flap as a fraction of its rest
 * area. FR-P1 (inextensibility) demands this ratio stay ≈ 1.0 for all
 * dihedrals; deviations indicate the page is stretching.
 *
 * Implementation: integrate over the same 5×7 fiducial grid plus the
 * implicit page corners by summing the chord-length × column-width of each
 * row segment. The harness uses a denser mesh in `Book.invariants.test.ts`;
 * this is the cheap real-time approximation.
 */
export function approxAreaRatio(opts: FiducialSampleOptions): number {
  // sampleAllFiducials emits in row-major (i outer, j inner): index = i*VS+j.
  const VS = FIDUCIAL_VS.length;
  const samples = sampleAllFiducials(opts);
  // Sum chord lengths along U for each V row.
  let totalSpanSum = 0;
  for (let j = 0; j < FIDUCIAL_VS.length; j++) {
    let span = 0;
    for (let i = 1; i < FIDUCIAL_US.length; i++) {
      const a = samples[(i - 1) * VS + j];
      const b = samples[i * VS + j];
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      const dz = a.pos.z - b.pos.z;
      span += Math.hypot(dx, dy, dz);
    }
    totalSpanSum += span;
  }
  // Span samples cover U ∈ [0.1, 0.9]; scale to full PAGE_WIDTH.
  const widthFrac = FIDUCIAL_US[FIDUCIAL_US.length - 1] - FIDUCIAL_US[0];
  const meanSpan = totalSpanSum / FIDUCIAL_VS.length;
  const spanArea = (meanSpan / widthFrac) * PAGE_WIDTH * PAGE_HEIGHT;
  return spanArea / (PAGE_WIDTH * PAGE_HEIGHT);
}

/**
 * Locate the nearest fiducial to a page-local UV point, returning its grid
 * index plus the UV residual (delta from the snapped grid cell).
 *
 * Used by the `drag-origin-fiducial` telemetry event — the diagnostic
 * report (see `docs/diagnostic-2026-05-14.md`) hypothesizes that the
 * page-stretching defect is sensitive to whether the drag origin sits ON a
 * vertex row vs. between rows.
 */
export function nearestFiducial(u: number, v: number): {
  i: number; j: number; du: number; dv: number;
} {
  let bestI = 0;
  let bestJ = 0;
  let bestD = Infinity;
  for (let i = 0; i < FIDUCIAL_US.length; i++) {
    for (let j = 0; j < FIDUCIAL_VS.length; j++) {
      const du = u - FIDUCIAL_US[i];
      const dv = v - FIDUCIAL_VS[j];
      const d = Math.hypot(du, dv);
      if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
    }
  }
  return {
    i: bestI,
    j: bestJ,
    du: u - FIDUCIAL_US[bestI],
    dv: v - FIDUCIAL_VS[bestJ],
  };
}
