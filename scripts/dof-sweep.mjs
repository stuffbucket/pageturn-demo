#!/usr/bin/env node
/**
 * dof-sweep.mjs — exhaustive Degree-of-Freedom sweep + invariant violation
 * analyzer.
 *
 * Drives the analytic JS replica of FLIP_VERT (mirrors
 * src/book/FiducialPositions.ts and harness/src/bootstrap.ts) plus a JS port
 * of the aerodynamic settle integrator (src/book/SettlePhysics.ts) through a
 * Latin-hypercube-sampled cross-product of the page's intended DOFs, scoring
 * each scenario against 13 invariants.
 *
 * Outputs (under contrib/debug/dof-sweep/ by default):
 *   - violations.jsonl            One JSON line per scenario with at least one
 *                                 invariant exceeding threshold.
 *   - top-violators.md            Per-invariant top-10 with repro recipes.
 *   - heatmap-<invariant>.html    70x16 max-violation heatmap, one per invariant.
 *   - summary.json                Run metadata + violation counts.
 *
 * CLI:
 *   node scripts/dof-sweep.mjs --samples 560000 --out contrib/debug/dof-sweep/
 *   node scripts/dof-sweep.mjs --quick                # 10x downsample
 *
 * The sweep is purely analytic — no Three.js, no GPU, no Playwright. A full
 * 560k-sample run takes a few minutes on a laptop; the --quick variant is
 * tuned for < 30 s so it can ride along in CI on every commit (npm run
 * dof:sweep:quick).
 *
 * Tracks issue #69 (sweep itself); cross-references #50, #51, #54, #63, #64,
 * #65, #68 from the violation clusters.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ── DOF constants (must match src/textures/atlas.ts + src/main.ts) ───────────
const FIDUCIAL_US = [0.1, 0.3, 0.5, 0.7, 0.9];
const FIDUCIAL_VS = [0.08, 0.22, 0.36, 0.50, 0.64, 0.78, 0.92];
const PAGE_WIDTH = 1.0;
const PAGE_HEIGHT = 1.4;
const BEND_AMOUNT = 0.4;
const BOOK_TILT = 0.76;
const NUM_LEAVES = 10;             // src/main.ts: numLeaves = 10
const MAX_CURL_ANGLE = Math.PI / 3;
const CURL_R_DEFAULT = 0.3;        // typical pageStock R_min when developable
const EXEMPT = 0.01 * PAGE_WIDTH;

// Per-invariant violation thresholds (a number > 0 means "out of spec").
const THRESHOLDS = {
  fr_p1:               0.01,   // (1) max chord/rest - 1   (>=  0.01 violates)
  no_tube:             0.15,   // (2) 1 - row chord/rest   (>=  0.15 violates)
  no_disappear:        4.0,    // (3) max |world_pos|/W
  curl_angle:          Math.PI / 3,  // (4) max |theta|
  spine_pin_local:     1e-4,   // (5) max |spine_x| local
  spine_pin_world:     1e-3,   // (6) max |spine_world_x|
  crease_tilt:         0.05,   // (7) |creaseDir.x|
  monotonic_phi:       0.0,    // (8) min(dphi/dt) * sign(dir): violation magnitude = max negative slope
  path_smoothness:     1.0,    // (9) max(|fid[t+1]-fid[t]|/(v_max*dt))
  settle_symmetry:     50.0,   // (10) |dur_fwd - dur_rev| in ms
  settle_sign:         0.0,    // (11) sign-mismatch fraction (>0 = violation)
  area_conservation:   0.01,   // (12) |area/rest - 1|
  rest_face_uv:        0.5,    // (13) UV-flip fraction during dihedral in [0, pi/2]
};

const INVARIANT_KEYS = Object.keys(THRESHOLDS);

// ── Analytic FLIP_VERT mirror ────────────────────────────────────────────────
function fiducialWorldPosition(uAngle, u, v, developable, curlR) {
  const origX = u * PAGE_WIDTH;
  let localX, localZ;
  if (developable) {
    const d = Math.abs(uAngle);
    const cosD = Math.cos(d), sinD = Math.sin(d);
    const rigidS = Math.min(origX, EXEMPT);
    const effS = Math.max(origX - EXEMPT, 0);
    const safeR = curlR > 1e-4 ? curlR : 1e-4;
    const theta = Math.min(effS / safeR, MAX_CURL_ANGLE);
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
  const c = Math.cos(-BOOK_TILT), s = Math.sin(-BOOK_TILT);
  return {
    x: localX,
    y: localY * c - localZ * s,
    z: localY * s + localZ * c,
    localX, localY, localZ,
  };
}

// ── Crease geometry (mirrors src/book/CreaseGeometry.ts) ────────────────────
function creaseFromDrag(corner, drag, isReverse, anchorY = null) {
  const W = PAGE_WIDTH, H = PAGE_HEIGHT;
  const dx = drag.x - corner.x;
  const dy = drag.y - corner.y;
  const horizontalPull = corner.x - drag.x;
  const span = isReverse ? 2 * W : W;
  const dihedral = Math.PI * Math.max(0, Math.min(1, horizontalPull / span));
  const perpX = -dy, perpY = dx;
  let originY, creaseDirX, creaseDirY;
  const HORIZ_EPS = 0.02 * H;
  if (Math.abs(perpX) < HORIZ_EPS) {
    originY = anchorY ?? corner.y; creaseDirX = 0; creaseDirY = 1;
  } else {
    if (anchorY !== null) {
      // Option B (issue #78): per-gesture spine anchor pins originY exactly.
      originY = anchorY;
    } else {
      const Mx = (corner.x + drag.x) / 2;
      const My = (corner.y + drag.y) / 2;
      const rawSpineY = My - Mx * perpY / perpX;
      const limit = H / 2;
      originY = limit * Math.tanh(rawSpineY / limit);
    }
    const len = Math.hypot(perpX, perpY);
    creaseDirX = perpX / len;
    creaseDirY = perpY / len;
    if (creaseDirY < 0) { creaseDirX = -creaseDirX; creaseDirY = -creaseDirY; }
  }
  return { dihedral, originOnEdge: { x: 0, y: originY }, creaseDir: { x: creaseDirX, y: creaseDirY } };
}

// ── Settle integrator (port of src/book/SettlePhysics.ts) ───────────────────
const DEFAULT_AERO = { G: 10, D: 4, omega: 18, Db: 18, kappa: 0.08, b0: 0.4, bMax: 0.7 };
const LEGACY_SETTLE = { G: 5.0, D: 6.5 };

function settleStep(state, dir, dt, p) {
  const phiAcc = dir * p.G * Math.sin(state.phi) - p.D * state.phiDot;
  const bAcc = p.omega * p.omega * (p.b0 - state.b) - p.Db * state.bDot + p.kappa * state.phiDot * state.phiDot;
  let phiDot = state.phiDot + phiAcc * dt;
  let bDot = state.bDot + bAcc * dt;
  let phi = state.phi + phiDot * dt;
  let b = state.b + bDot * dt;
  if (phi < 0) { phi = 0; if (phiDot < 0) phiDot = 0; }
  if (phi > Math.PI) { phi = Math.PI; if (phiDot > 0) phiDot = 0; }
  if (b < 0) { b = 0; if (bDot < 0) bDot = 0; }
  if (b > p.bMax) { b = p.bMax; if (bDot > 0) bDot = 0; }
  return { phi, phiDot, b, bDot };
}

function settleConverged(state, dir, p, eps = 0.005) {
  const target = dir === 1 ? Math.PI : 0;
  const dPhi = state.phi - target;
  const energy = 0.5 * state.phiDot * state.phiDot + p.G * (1 - Math.cos(dPhi));
  if (energy < eps) return true;
  return Math.abs(dPhi) < 0.03 && Math.abs(state.phiDot) < 0.3 && Math.abs(state.b - p.b0) < 0.02;
}

// Run settle to convergence; return duration in ms and bend-sign trajectory.
function simulateSettle(release, dir, useAero) {
  const params = useAero ? DEFAULT_AERO : { ...DEFAULT_AERO, G: LEGACY_SETTLE.G, D: LEGACY_SETTLE.D };
  let state = { phi: release.phi, phiDot: release.phiDot, b: params.b0, bDot: 0 };
  const dt = 1 / 240;
  const maxSteps = 5 * 240;        // 5 s cap
  let steps = 0;
  const signSamples = [];
  while (steps < maxSteps) {
    const bendSign = Math.sign(state.b * Math.sin(2 * state.phi));
    if (steps % 24 === 0) signSamples.push(bendSign);
    if (settleConverged(state, dir, params)) break;
    state = settleStep(state, dir, dt, params);
    steps += 1;
  }
  return { durationMs: (steps * dt) * 1000, signSamples };
}

// ── Latin-hypercube + RNG ────────────────────────────────────────────────────
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t |= 0; t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function lhs(n, dims, rng) {
  const out = Array.from({ length: n }, () => new Array(dims));
  for (let d = 0; d < dims; d++) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < n; i++) out[i][d] = (order[i] + rng()) / n;
  }
  return out;
}

// ── Velocity profiles map progress in [0,1] -> reparameterized progress ─────
const VEL_PROFILES = {
  const: (u) => u,
  accel: (u) => u * u,
  decel: (u) => 1 - (1 - u) * (1 - u),
  pause: (u) => u < 0.45 ? u * 0.5 : u < 0.55 ? 0.225 + (u - 0.45) * 0.05 : 0.225 + 0.005 + (u - 0.55) * (0.5 - 0.005) / 0.45,
};
const VEL_NAMES = Object.keys(VEL_PROFILES);

const FLAG_COMBOS = [
  { surface: 'sin2phi',     settle: 'legacy' },
  { surface: 'sin2phi',     settle: 'aero' },
  { surface: 'developable', settle: 'legacy' },
  { surface: 'developable', settle: 'aero' },
];

// ── Per-scenario evaluator ───────────────────────────────────────────────────
function evaluateScenario(s) {
  // Drag start in page-local UV (drag origin on grabbed page).
  // page = 0 -> right page (corner at (W, H/2)), page = 1 -> left (cover).
  // For modeling we treat the corner as the page corner farthest from spine.
  const u0 = FIDUCIAL_US[s.fid_i] + s.subDu * 0.2;       // 0.2 = nominal cell-width fraction
  const v0 = FIDUCIAL_VS[s.fid_j] + s.subDv * 0.14;
  // Corner is the "grabbed" corner — the one closest to the drag start.
  const corner = { x: PAGE_WIDTH, y: v0 < 0.5 ? -PAGE_HEIGHT / 2 : PAGE_HEIGHT / 2 };
  // Drag end: vector of length r*W in direction theta from drag start (page UV -> 2D).
  const startX = u0 * PAGE_WIDTH;
  const startY = (v0 - 0.5) * PAGE_HEIGHT;
  const endX = startX + Math.cos(s.theta) * s.r * PAGE_WIDTH;
  const endY = startY + Math.sin(s.theta) * s.r * PAGE_WIDTH;

  const isReverse = s.direction === 'reverse';
  const developable = s.flags.surface === 'developable';
  const aero = s.flags.settle === 'aero';

  const violations = {};
  for (const k of INVARIANT_KEYS) violations[k] = 0;

  // Frame loop: 30 frames over the gesture path using velocity profile.
  const FRAMES = 30;
  const dtFrame = 1 / 60;            // ~17 ms
  const remappedT = [];
  const phiSeries = [];
  const fidPaths = {};                // id -> array of {x,y,z}
  let lastFidPos = null;
  let pathSmoothMax = 0;
  let creaseTiltMax = 0;
  let spineLocalMax = 0, spineWorldMax = 0;
  let curlMax = 0;
  let frP1Max = 0;
  let noDisappearMax = 0;
  let noTubeMax = 0;
  let areaConsMax = 0;
  let restFaceFlips = 0, restFaceFrames = 0;

  // Rest reference area: PAGE_WIDTH * PAGE_HEIGHT (we measure approx area
  // ratio per frame using fiducial-grid chord sums, mirror of approxAreaRatio).
  const widthFrac = FIDUCIAL_US[FIDUCIAL_US.length - 1] - FIDUCIAL_US[0];

  // Per-gesture spine anchor for Option B fix (issue #78). The anchor is
  // chosen at pointerdown — i.e. it equals the click's y in page-local
  // coords (clamped to the page interior). Stays constant for the whole
  // gesture, killing the originY drift that drives the spine-strip stretch.
  const halfH = PAGE_HEIGHT / 2;
  const anchorY = Math.max(-halfH, Math.min(halfH, startY));

  for (let f = 0; f < FRAMES; f++) {
    const u = f / (FRAMES - 1);
    const tProg = VEL_PROFILES[s.velocity](u);
    const dragX = startX + (endX - startX) * tProg;
    const dragY = startY + (endY - startY) * tProg;
    const cr = creaseFromDrag(corner, { x: dragX, y: dragY }, isReverse, anchorY);
    const phi = cr.dihedral;                    // [0, pi]
    const uAngle = isReverse ? phi : -phi;      // shader convention
    remappedT.push(tProg);
    phiSeries.push(phi);

    creaseTiltMax = Math.max(creaseTiltMax, Math.abs(cr.creaseDir.x));

    // Sample fiducial grid.
    let rowSpanSum = 0;
    let rowMin = Infinity;
    for (let i = 0; i < FIDUCIAL_US.length; i++) {
      for (let j = 0; j < FIDUCIAL_VS.length; j++) {
        const uu = FIDUCIAL_US[i], vv = FIDUCIAL_VS[j];
        const p = fiducialWorldPosition(uAngle, uu, vv, developable, CURL_R_DEFAULT);
        const id = `${i}_${j}`;
        if (!fidPaths[id]) fidPaths[id] = [];
        fidPaths[id].push(p);
        // Spine-pin: u=0 isn't sampled; check the leftmost column (i=0 uses u=0.1).
        // For an honest spine check, sample u=0 explicitly.
        if (i === 0) {
          const sp = fiducialWorldPosition(uAngle, 0, vv, developable, CURL_R_DEFAULT);
          spineLocalMax = Math.max(spineLocalMax, Math.abs(sp.localX));
          spineWorldMax = Math.max(spineWorldMax, Math.abs(sp.x));
        }
        // No-disappear: |world|/W
        const mag = Math.hypot(p.x, p.y, p.z) / PAGE_WIDTH;
        if (mag > noDisappearMax) noDisappearMax = mag;
      }
    }

    // Curl angle (developable only: theta = effS/R clamped at MAX_CURL_ANGLE).
    if (developable) {
      const effS = Math.max(PAGE_WIDTH - EXEMPT, 0);
      const theta = Math.min(effS / CURL_R_DEFAULT, MAX_CURL_ANGLE);
      curlMax = Math.max(curlMax, theta);
    }

    // Per-row chord & area.
    let totalSpan = 0;
    for (let j = 0; j < FIDUCIAL_VS.length; j++) {
      let span = 0;
      let restSpan = 0;
      for (let i = 1; i < FIDUCIAL_US.length; i++) {
        const a = fidPaths[`${i - 1}_${j}`].at(-1);
        const b = fidPaths[`${i}_${j}`].at(-1);
        span += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        restSpan += (FIDUCIAL_US[i] - FIDUCIAL_US[i - 1]) * PAGE_WIDTH;
      }
      totalSpan += span;
      const ratio = span / restSpan;
      if (ratio - 1 > frP1Max) frP1Max = ratio - 1;
      if (1 - ratio > noTubeMax) noTubeMax = 1 - ratio;
      if (ratio < rowMin) rowMin = ratio;
    }
    const meanSpan = totalSpan / FIDUCIAL_VS.length;
    const areaRatio = (meanSpan / widthFrac) * PAGE_WIDTH * PAGE_HEIGHT / (PAGE_WIDTH * PAGE_HEIGHT);
    areaConsMax = Math.max(areaConsMax, Math.abs(areaRatio - 1));

    // Rest-face-during-motion (UV consistency proxy): in [0, pi/2] the front
    // face's normal should still point up. We check sign(z-component of
    // surface normal at u=0.5). A flip in this window flags hidden front face.
    if (phi < Math.PI / 2 && phi > 0.01) {
      restFaceFrames += 1;
      const u1 = 0.5;
      const a = fiducialWorldPosition(uAngle, u1 - 0.05, 0.5, developable, CURL_R_DEFAULT);
      const b = fiducialWorldPosition(uAngle, u1 + 0.05, 0.5, developable, CURL_R_DEFAULT);
      const c = fiducialWorldPosition(uAngle, u1, 0.55, developable, CURL_R_DEFAULT);
      // Approx tangent vectors in world space.
      const tx = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const ty = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const nz = tx.x * ty.y - tx.y * ty.x;        // z-component of cross product
      // For an unflipped front face we expect nz to keep one sign — flips count.
      if (nz < 0) restFaceFlips += 1;
    }

    // Path smoothness using fiducial 2_3 (page center).
    const centerNow = fidPaths['2_3'].at(-1);
    if (lastFidPos) {
      const dr = Math.hypot(centerNow.x - lastFidPos.x, centerNow.y - lastFidPos.y, centerNow.z - lastFidPos.z);
      const vMax = 4 * PAGE_WIDTH;   // assume 4 W/s as the practical drag cap
      const ratio = dr / (vMax * dtFrame);
      if (ratio > pathSmoothMax) pathSmoothMax = ratio;
    }
    lastFidPos = centerNow;
  }

  violations.fr_p1 = frP1Max;
  violations.no_tube = noTubeMax;
  violations.no_disappear = noDisappearMax;
  violations.curl_angle = curlMax;
  violations.spine_pin_local = spineLocalMax;
  violations.spine_pin_world = spineWorldMax;
  violations.crease_tilt = creaseTiltMax;
  violations.path_smoothness = pathSmoothMax;
  violations.area_conservation = areaConsMax;
  violations.rest_face_uv = restFaceFrames > 0 ? restFaceFlips / restFaceFrames : 0;

  // Monotonic phi: min slope * sign(direction).
  let minSlope = Infinity;
  for (let i = 1; i < phiSeries.length; i++) {
    const dphi = phiSeries[i] - phiSeries[i - 1];
    const slope = dphi * (isReverse ? -1 : 1);
    if (slope < minSlope) minSlope = slope;
  }
  violations.monotonic_phi = Math.max(0, -minSlope);

  // Settle (only on commit; cancel terminates at phi=0 with low energy).
  if (s.release === 'commit') {
    const dirFwd = isReverse ? -1 : 1;
    const dirRev = -dirFwd;
    const phi0 = phiSeries.at(-1) ?? 0;
    // Estimate phiDot at release from the last two phi samples.
    const dphi = phiSeries.length >= 2 ? phiSeries.at(-1) - phiSeries.at(-2) : 0;
    const phiDot0 = dphi / dtFrame;
    const fwd = simulateSettle({ phi: phi0, phiDot: phiDot0 * dirFwd }, dirFwd, aero);
    const rev = simulateSettle({ phi: phi0, phiDot: phiDot0 * dirRev }, dirRev, aero);
    violations.settle_symmetry = Math.abs(fwd.durationMs - rev.durationMs);
    // Bend-envelope sign asymmetry (#63): count sign disagreements between
    // forward and reverse traces at matching steps.
    const N = Math.min(fwd.signSamples.length, rev.signSamples.length);
    let mismatches = 0;
    for (let k = 0; k < N; k++) {
      if (fwd.signSamples[k] !== 0 && rev.signSamples[k] !== 0 &&
          fwd.signSamples[k] !== -rev.signSamples[k]) mismatches += 1;
    }
    violations.settle_sign = N > 0 ? mismatches / N : 0;
  } else {
    violations.settle_symmetry = 0;
    violations.settle_sign = 0;
  }

  return violations;
}

// ── Sweep orchestrator ──────────────────────────────────────────────────────
function isViolation(key, magnitude) {
  return magnitude > THRESHOLDS[key];
}

function buildScenarios(targetSamples) {
  // Discrete enumeration: fiducial (35*2 = 70) x direction (2) x release (2) x flag (4) = 1,120
  const discrete = [];
  for (let pageSide = 0; pageSide < 2; pageSide++) {
    for (let i = 0; i < FIDUCIAL_US.length; i++) {
      for (let j = 0; j < FIDUCIAL_VS.length; j++) {
        for (const direction of ['forward', 'reverse']) {
          for (const release of ['commit', 'cancel']) {
            for (const flags of FLAG_COMBOS) {
              discrete.push({ pageSide, fid_i: i, fid_j: j, direction, release, flags });
            }
          }
        }
      }
    }
  }
  const nLH = Math.max(1, Math.floor(targetSamples / discrete.length));
  const rng = mulberry32(42);
  const samples = lhs(nLH, 5, rng);    // [subDu, subDv, theta, r_index, vel_index, spread_frac]; we use 5 dims but spread folds into pageSide
  const scenarios = [];
  let id = 0;
  const rDistances = [0.05, 0.1, 0.2, 0.4, 0.8, 1.5];
  for (const d of discrete) {
    for (const lh of samples) {
      const subDu = lh[0] - 0.5;
      const subDv = lh[1] - 0.5;
      const theta = lh[2] * 2 * Math.PI;
      const r = rDistances[Math.min(rDistances.length - 1, Math.floor(lh[3] * rDistances.length))];
      const velocity = VEL_NAMES[Math.min(VEL_NAMES.length - 1, Math.floor(lh[4] * VEL_NAMES.length))];
      const spread = Math.min(NUM_LEAVES - 1, Math.floor(lh[3] * NUM_LEAVES));   // reuse dim 3
      scenarios.push({
        id: `s${id++}`,
        ...d, subDu, subDv, theta, r, velocity, spread,
      });
    }
  }
  return scenarios;
}

function reproRecipe(s) {
  const u = FIDUCIAL_US[s.fid_i] + s.subDu * 0.2;
  const v = FIDUCIAL_VS[s.fid_j] + s.subDv * 0.14;
  const dx = (Math.cos(s.theta) * s.r).toFixed(2);
  const dy = (Math.sin(s.theta) * s.r).toFixed(2);
  const flagStr = `?surface=${s.flags.surface}&settle=${s.flags.settle}&fiducials=1&debug=1`;
  return `${flagStr} | spread=${s.spread} ${s.direction === 'forward' ? 'fwd' : 'rev'} grab page${s.pageSide ? 'L' : 'R'} fid (${s.fid_i},${s.fid_j}) at u=${u.toFixed(2)},v=${v.toFixed(2)} drag (${dx}W,${dy}W) ${s.velocity} ${s.release}`;
}

// ── HTML heatmap (70 fiducial cells x 16 theta bins) ────────────────────────
function buildHeatmapHtml(invariant, scenarios, getMag) {
  const NTHETA = 16;
  // 70 = pageSide(2) * i(5) * j(7); we'll lay out as 2 tables of 5x7.
  const grid = (pageSide) => {
    const cells = Array.from({ length: 5 }, () =>
      Array.from({ length: 7 }, () => new Array(NTHETA).fill(0))
    );
    for (const s of scenarios) {
      if (s.pageSide !== pageSide) continue;
      const m = getMag(s);
      const tBin = Math.min(NTHETA - 1, Math.floor(((s.theta % (2 * Math.PI)) / (2 * Math.PI)) * NTHETA));
      if (m > cells[s.fid_i][s.fid_j][tBin]) cells[s.fid_i][s.fid_j][tBin] = m;
    }
    return cells;
  };
  const thr = THRESHOLDS[invariant];
  const color = (m) => {
    if (thr <= 0) return m > 0 ? '#7a1f1f' : '#1e6f3a';
    const x = m / thr;
    if (x < 1) return '#1e6f3a';
    if (x < 2) return '#a07a1f';
    if (x < 5) return '#c25f2a';
    return '#7a1f1f';
  };
  const renderTable = (pageSide) => {
    const cells = grid(pageSide);
    let out = `<h2>Page ${pageSide === 0 ? 'R' : 'L'}</h2><table><thead><tr><th>i\\j</th>`;
    for (let j = 0; j < 7; j++) out += `<th>j=${j}</th>`;
    out += '</tr></thead><tbody>';
    for (let i = 0; i < 5; i++) {
      out += `<tr><th>i=${i}</th>`;
      for (let j = 0; j < 7; j++) {
        out += '<td>';
        for (let t = 0; t < NTHETA; t++) {
          const m = cells[i][j][t];
          out += `<span class=cell style="background:${color(m)}" title="theta_bin=${t} max=${m.toFixed(4)}"></span>`;
        }
        out += '</td>';
      }
      out += '</tr>';
    }
    out += '</tbody></table>';
    return out;
  };
  return `<!doctype html><meta charset=utf-8><title>${invariant} heatmap</title>
<style>body{font:13px ui-sans-serif;padding:20px;max-width:1100px;margin:auto}
table{border-collapse:collapse;margin:8px 0 24px}th,td{border:1px solid #ddd;padding:3px;text-align:center}
.cell{display:inline-block;width:8px;height:14px;margin:0 1px}h1{margin-bottom:8px}
.legend span{display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:4px}</style>
<h1>${invariant} max-violation heatmap (threshold ${thr})</h1>
<p class=legend><span style="background:#1e6f3a"></span>under threshold
&nbsp;<span style="background:#a07a1f"></span>1-2x &nbsp;
<span style="background:#c25f2a"></span>2-5x &nbsp;
<span style="background:#7a1f1f"></span>&gt;5x</p>
<p>Each column inside a (i,j) cell is a theta bin (0..2pi, 16 bins). Aggregated max across all other DOFs.</p>
${renderTable(0)}${renderTable(1)}`;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let samples = 560000;
  let outDir = resolve(REPO_ROOT, 'contrib/debug/dof-sweep');
  let quick = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--samples') samples = parseInt(args[++i], 10);
    else if (args[i] === '--out') outDir = resolve(args[++i]);
    else if (args[i] === '--quick') quick = true;
  }
  if (quick) samples = Math.min(samples, 5600);

  await mkdir(outDir, { recursive: true });
  const scenarios = buildScenarios(samples);
  console.log(`[dof-sweep] ${scenarios.length} scenarios across ${INVARIANT_KEYS.length} invariants`);

  const t0 = Date.now();
  const violationCounts = Object.fromEntries(INVARIANT_KEYS.map(k => [k, 0]));
  const topByInvariant = Object.fromEntries(INVARIANT_KEYS.map(k => [k, []]));
  const TOP_N = 10;

  const jsonlPath = resolve(outDir, 'violations.jsonl');
  const jsonl = createWriteStream(jsonlPath);
  let emittedLines = 0;

  // Memo: also remember every scenario's violation map for heatmap build (lean).
  const allMags = new Array(scenarios.length);

  for (let idx = 0; idx < scenarios.length; idx++) {
    const s = scenarios[idx];
    const v = evaluateScenario(s);
    allMags[idx] = v;
    let any = false;
    for (const k of INVARIANT_KEYS) {
      if (isViolation(k, v[k])) {
        any = true;
        violationCounts[k] += 1;
        const t = topByInvariant[k];
        if (t.length < TOP_N || v[k] > t[t.length - 1].mag) {
          t.push({ mag: v[k], scenario: s });
          t.sort((a, b) => b.mag - a.mag);
          if (t.length > TOP_N) t.pop();
        }
      }
    }
    if (any) {
      const dof = {
        fiducial: [s.fid_i, s.fid_j],
        page_side: s.pageSide,
        subcell: [+s.subDu.toFixed(3), +s.subDv.toFixed(3)],
        theta: +s.theta.toFixed(4),
        r: s.r,
        velocity: s.velocity,
        spread: s.spread,
        direction: s.direction,
        release: s.release,
        flags: s.flags,
      };
      jsonl.write(JSON.stringify({ id: s.id, dof, violations: v }) + '\n');
      emittedLines += 1;
    }
    if ((idx + 1) % 10000 === 0) {
      console.log(`[dof-sweep] ${idx + 1}/${scenarios.length} (${((idx + 1) / scenarios.length * 100).toFixed(1)}%) violations=${emittedLines}`);
    }
  }
  await new Promise((res) => jsonl.end(res));
  const elapsedSec = (Date.now() - t0) / 1000;
  console.log(`[dof-sweep] done in ${elapsedSec.toFixed(1)} s, ${emittedLines} violation records -> ${jsonlPath}`);

  // top-violators.md
  let md = `# DOF sweep — top violators (${new Date().toISOString().slice(0, 10)})\n\n`;
  md += `Run: ${scenarios.length} scenarios, ${elapsedSec.toFixed(1)} s elapsed.\n\n`;
  md += `| Invariant | Threshold | Violations | Rate |\n|---|---|---|---|\n`;
  for (const k of INVARIANT_KEYS) {
    md += `| ${k} | ${THRESHOLDS[k]} | ${violationCounts[k]} | ${(100 * violationCounts[k] / scenarios.length).toFixed(2)}% |\n`;
  }
  md += '\n';
  for (const k of INVARIANT_KEYS) {
    md += `## ${k} (threshold ${THRESHOLDS[k]})\n\n`;
    if (topByInvariant[k].length === 0) {
      md += `_no violations_\n\n`;
      continue;
    }
    md += `| Rank | Magnitude | Repro recipe |\n|---|---|---|\n`;
    topByInvariant[k].forEach((t, n) => {
      md += `| ${n + 1} | ${t.mag.toFixed(4)} | ${reproRecipe(t.scenario)} |\n`;
    });
    md += '\n';
  }
  await writeFile(resolve(outDir, 'top-violators.md'), md);

  // Heatmaps. Build an id->index map once for O(1) lookup.
  const idxMap = new Map(scenarios.map((s, i) => [s.id, i]));
  for (const k of INVARIANT_KEYS) {
    const html = buildHeatmapHtml(k, scenarios, (s) => allMags[idxMap.get(s.id)][k]);
    await writeFile(resolve(outDir, `heatmap-${k}.html`), html);
  }

  // Summary JSON.
  const summary = {
    generated: new Date().toISOString(),
    scenarios: scenarios.length,
    elapsedSec,
    thresholds: THRESHOLDS,
    violationCounts,
    topByInvariant: Object.fromEntries(
      INVARIANT_KEYS.map(k => [k, topByInvariant[k].map(t => ({ mag: t.mag, dof: { fid: [t.scenario.fid_i, t.scenario.fid_j], theta: t.scenario.theta, r: t.scenario.r, dir: t.scenario.direction, release: t.scenario.release, flags: t.scenario.flags } }))])
    ),
  };
  await writeFile(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`[dof-sweep] outputs in ${outDir}`);
  return summary;
}

main().catch(e => { console.error(e); process.exit(1); });
