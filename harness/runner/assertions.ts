// harness/runner/assertions.ts
//
// Runner-side assertion evaluator. Called after a scenario completes,
// receives the captured telemetry / trajectory / screenshot artifacts,
// and returns a list of pass/fail records.
//
// Each Assertion type maps 1:1 to an evaluator below. Adding a new
// assertion means: extend the discriminated union in
// `harness/src/ccapture.d.ts`, then add a case here. No bootstrap
// changes are needed for assertions that operate purely on artifacts
// the bootstrap already exposes.

import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Assertion,
  CapturedTelemetryEvent,
  TrajectoryResult,
} from '../src/ccapture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// repo root = harness/.. — the runner cwd is /work/harness in Docker,
// /…/repo/harness on the host. Either way, .. is the repo root.
export const REPO_ROOT = resolve(__dirname, '..', '..');

export interface AssertionContext {
  scenarioName: string;
  telemetry: CapturedTelemetryEvent[];
  trajectories?: TrajectoryResult;
  /** Map of "atT_ms" -> screenshot Buffer (PNG). */
  screenshots: Map<number, Buffer>;
  /** Viewport so screenshot pixel offsets can be derived from canvas-fraction coords. */
  viewport: { width: number; height: number };
}

export interface AssertionResult {
  ok: boolean;
  type: Assertion['type'];
  description: string;
  detail?: string;
}

export async function evaluate(
  ctx: AssertionContext,
  assertion: Assertion,
): Promise<AssertionResult> {
  const desc = assertion.description ?? assertion.type;
  switch (assertion.type) {
    case 'telemetry-event':
      return evalTelemetry(ctx, assertion, desc);
    case 'file-exists-glob':
      return evalFileExists(ctx, assertion, desc);
    case 'pixel-min-luma':
      return evalPixelLuma(ctx, assertion, desc);
    case 'pixel-max-variance':
      return evalPixelVariance(ctx, assertion, desc);
    case 'pixel-edge-transitions':
      return evalPixelEdgeTransitions(ctx, assertion, desc);
    case 'trajectory':
      return evalTrajectory(ctx, assertion, desc);
  }
}

// ── Telemetry ──────────────────────────────────────────────────────────────
function evalTelemetry(
  ctx: AssertionContext,
  a: Extract<Assertion, { type: 'telemetry-event' }>,
  desc: string,
): AssertionResult {
  const candidates = ctx.telemetry.filter((e) => {
    if (e.type !== a.event) return false;
    if (a.afterEventAtT !== undefined && e.tScenarioMs < a.afterEventAtT) return false;
    if (a.where) {
      for (const k of Object.keys(a.where)) {
        if (!deepEqual((e.payload as Record<string, unknown>)[k], a.where[k])) return false;
      }
    }
    return true;
  });
  if (candidates.length === 0) {
    const matchingType = ctx.telemetry.filter((e) => e.type === a.event);
    return {
      ok: false,
      type: a.type,
      description: desc,
      detail: `no telemetry event matched. Saw ${matchingType.length} of type "${a.event}". Looked for where=${JSON.stringify(a.where ?? {})} after t=${a.afterEventAtT ?? 0}ms`,
    };
  }
  if (a.withinMsAfterT !== undefined && a.afterEventAtT !== undefined) {
    const earliest = candidates.reduce((m, e) => (e.tScenarioMs < m.tScenarioMs ? e : m));
    const dt = earliest.tScenarioMs - a.afterEventAtT;
    if (dt > a.withinMsAfterT) {
      return {
        ok: false,
        type: a.type,
        description: desc,
        detail: `event seen at t=${earliest.tScenarioMs.toFixed(0)}ms, but ${dt.toFixed(0)}ms > withinMsAfterT=${a.withinMsAfterT}ms (afterEventAtT=${a.afterEventAtT})`,
      };
    }
  }
  return { ok: true, type: a.type, description: desc };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

// ── File-exists ────────────────────────────────────────────────────────────
async function evalFileExists(
  _ctx: AssertionContext,
  a: Extract<Assertion, { type: 'file-exists-glob' }>,
  desc: string,
): Promise<AssertionResult> {
  // Simple glob: only support a single trailing/leading wildcard plus
  // extension whitelist. Avoid pulling in a glob dep for one assertion type.
  // The glob is split on '*' — only one '*' allowed.
  if ((a.glob.match(/\*/g) ?? []).length !== 1) {
    return {
      ok: false,
      type: a.type,
      description: desc,
      detail: `glob must contain exactly one '*': got "${a.glob}"`,
    };
  }
  const [prefix, suffix] = a.glob.split('*');
  const dir = join(REPO_ROOT, dirname(prefix));
  const basePrefix = prefix.split('/').pop() ?? '';
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    return {
      ok: false,
      type: a.type,
      description: desc,
      detail: `directory not readable: ${dir} (${(err as Error).message})`,
    };
  }
  const exts = a.extensions && a.extensions.length > 0 ? a.extensions : null;
  const matches = entries.filter((f) => {
    if (!f.startsWith(basePrefix)) return false;
    if (suffix) {
      // suffix should match end (after extension stripping); if exts allowed,
      // file must end with a permitted extension.
      if (exts) {
        if (!exts.some((e) => f.endsWith(e))) return false;
        const stripped = f.slice(0, -1 * exts.find((e) => f.endsWith(e))!.length);
        return stripped.endsWith(suffix);
      }
      return f.endsWith(suffix);
    }
    if (exts && !exts.some((e) => f.endsWith(e))) return false;
    return true;
  });
  if (matches.length === 0) {
    return {
      ok: false,
      type: a.type,
      description: desc,
      detail: `no files in ${dir} matched prefix="${basePrefix}" suffix="${suffix}" exts=${JSON.stringify(exts)}`,
    };
  }
  if (a.sidecarSessionId !== undefined) {
    for (const f of matches) {
      const sidecarPath = join(dir, `${f}.json`);
      try {
        const raw = await fs.readFile(sidecarPath, 'utf8');
        const parsed = JSON.parse(raw) as { sessionId?: string };
        if (parsed.sessionId === a.sidecarSessionId) {
          return { ok: true, type: a.type, description: desc, detail: `matched ${f}` };
        }
      } catch { /* try next */ }
    }
    return {
      ok: false,
      type: a.type,
      description: desc,
      detail: `${matches.length} files matched glob but none had sidecar with sessionId="${a.sidecarSessionId}"`,
    };
  }
  return { ok: true, type: a.type, description: desc, detail: `matched ${matches[0]}` };
}

// ── Pixel checks ───────────────────────────────────────────────────────────
// We avoid pulling in sharp/jimp. Instead we decode PNG with a tiny inline
// reader powered by `playwright`'s screenshot output piped through a Node
// stream — but for raw pixel access we still need decoding. The cheapest
// route is to take the screenshot via Playwright's `page.evaluate` after
// drawing the canvas to a 2D context: ImageData gives us raw RGBA.
// Therefore the runner's "screenshots" map actually stores RGBA Buffers
// (4 bytes per pixel, row-major), tagged with width/height in the buffer
// header (8 bytes prefix: u32 width, u32 height, big-endian).

interface RGBA { width: number; height: number; data: Uint8ClampedArray; }

function unpackRGBA(buf: Buffer): RGBA {
  const width = buf.readUInt32BE(0);
  const height = buf.readUInt32BE(4);
  const data = new Uint8ClampedArray(buf.subarray(8));
  return { width, height, data };
}

function regionPixels(rgba: RGBA, region: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.max(0, Math.floor(region.x * rgba.width));
  const y0 = Math.max(0, Math.floor(region.y * rgba.height));
  const x1 = Math.min(rgba.width, Math.floor((region.x + region.w) * rgba.width));
  const y1 = Math.min(rgba.height, Math.floor((region.y + region.h) * rgba.height));
  return { x0, y0, x1, y1 };
}

function luma(r: number, g: number, b: number): number {
  // Rec. 601 luma — adequate for "is this the page (light) vs the background (dark)".
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function evalPixelLuma(
  ctx: AssertionContext,
  a: Extract<Assertion, { type: 'pixel-min-luma' }>,
  desc: string,
): AssertionResult {
  const buf = ctx.screenshots.get(a.atT);
  if (!buf) {
    return { ok: false, type: a.type, description: desc, detail: `no screenshot for atT=${a.atT}` };
  }
  const rgba = unpackRGBA(buf);
  const { x0, y0, x1, y1 } = regionPixels(rgba, a.region);
  let sum = 0; let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * rgba.width + x) * 4;
      sum += luma(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]);
      count++;
    }
  }
  const mean = count ? sum / count : 0;
  const ok = mean >= a.minMeanLuma;
  return {
    ok,
    type: a.type,
    description: desc,
    detail: `mean luma=${mean.toFixed(2)} (threshold>=${a.minMeanLuma}, region=${count}px @ ${x0},${y0} -> ${x1},${y1})`,
  };
}

function evalPixelVariance(
  ctx: AssertionContext,
  a: Extract<Assertion, { type: 'pixel-max-variance' }>,
  desc: string,
): AssertionResult {
  const buf = ctx.screenshots.get(a.atT);
  if (!buf) {
    return { ok: false, type: a.type, description: desc, detail: `no screenshot for atT=${a.atT}` };
  }
  const rgba = unpackRGBA(buf);
  const { x0, y0, x1, y1 } = regionPixels(rgba, a.region);
  let sumDelta = 0; let pairs = 0;
  // Mean absolute luma delta between horizontally-adjacent pixels.
  // Z-fighting bleed-through manifests as per-pixel noise within an otherwise
  // smooth color field, inflating this metric.
  for (let y = y0; y < y1; y++) {
    let prevL = -1;
    for (let x = x0; x < x1; x++) {
      const i = (y * rgba.width + x) * 4;
      const L = luma(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]);
      if (prevL >= 0) {
        sumDelta += Math.abs(L - prevL);
        pairs++;
      }
      prevL = L;
    }
  }
  const mean = pairs ? sumDelta / pairs : 0;
  const ok = mean <= a.maxMeanAdjacentDelta;
  return {
    ok,
    type: a.type,
    description: desc,
    detail: `mean adjacent luma Δ=${mean.toFixed(2)} (threshold<=${a.maxMeanAdjacentDelta}, ${pairs} pixel pairs sampled)`,
  };
}

// ── Edge transitions ───────────────────────────────────────────────────────
//
// Counts adjacent-pixel pairs whose luma differs by more than a threshold.
// Smooth boundaries produce one transition per row (or column) where the
// silhouette crosses the sweep line. A houndstooth/sawtooth boundary
// produced by per-vertex classifier z-fighting introduces many extra
// zig-zag transitions. The pre-fix bug from PR #33 inflated this count by
// roughly 5–10x; the threshold is set generously to allow legitimate
// content variation while still failing on the houndstooth pattern.
function evalPixelEdgeTransitions(
  ctx: AssertionContext,
  a: Extract<Assertion, { type: 'pixel-edge-transitions' }>,
  desc: string,
): AssertionResult {
  const buf = ctx.screenshots.get(a.atT);
  if (!buf) {
    return { ok: false, type: a.type, description: desc, detail: `no screenshot for atT=${a.atT}` };
  }
  const rgba = unpackRGBA(buf);
  const { x0, y0, x1, y1 } = regionPixels(rgba, a.region);
  let transitions = 0;
  if (a.axis === 'h') {
    for (let y = y0; y < y1; y++) {
      let prevL = -1;
      for (let x = x0; x < x1; x++) {
        const i = (y * rgba.width + x) * 4;
        const L = luma(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]);
        if (prevL >= 0 && Math.abs(L - prevL) > a.lumaDeltaThreshold) transitions++;
        prevL = L;
      }
    }
  } else {
    for (let x = x0; x < x1; x++) {
      let prevL = -1;
      for (let y = y0; y < y1; y++) {
        const i = (y * rgba.width + x) * 4;
        const L = luma(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]);
        if (prevL >= 0 && Math.abs(L - prevL) > a.lumaDeltaThreshold) transitions++;
        prevL = L;
      }
    }
  }
  const okMax = a.maxTransitions === undefined || transitions <= a.maxTransitions;
  const okMin = a.minTransitions === undefined || transitions >= a.minTransitions;
  const ok = okMax && okMin;
  const bounds = [
    a.minTransitions !== undefined ? `>=${a.minTransitions}` : null,
    a.maxTransitions !== undefined ? `<=${a.maxTransitions}` : null,
  ].filter(Boolean).join(' and ');
  return {
    ok,
    type: a.type,
    description: desc,
    detail: `axis=${a.axis} transitions=${transitions} (need ${bounds || '(no bound)'}, region=${x1 - x0}x${y1 - y0}px @ ${x0},${y0}, lumaΔ>${a.lumaDeltaThreshold})`,
  };
}

// ── Trajectory ─────────────────────────────────────────────────────────────
function evalTrajectory(
  ctx: AssertionContext,
  a: Extract<Assertion, { type: 'trajectory' }>,
  desc: string,
): AssertionResult {
  if (!ctx.trajectories) {
    return { ok: false, type: a.type, description: desc, detail: 'no trajectory data captured' };
  }
  const samples = ctx.trajectories.fiducials[a.fiducial];
  if (!samples) {
    return {
      ok: false,
      type: a.type,
      description: desc,
      detail: `unknown fiducial "${a.fiducial}". known: ${Object.keys(ctx.trajectories.fiducials).slice(0, 5).join(',')}…`,
    };
  }
  const axisIdx = { x: 1, y: 2, z: 3 }[a.axis];
  let candidates = samples;
  if (a.atTApprox !== undefined) {
    const closest = samples.reduce((best, s) =>
      Math.abs(s[0] - a.atTApprox!) < Math.abs(best[0] - a.atTApprox!) ? s : best);
    candidates = [closest];
  }
  const values = candidates.map((s) => s[axisIdx]);
  let observed: number;
  switch (a.op) {
    case 'abs-max': observed = Math.max(...values.map(Math.abs)); break;
    case 'abs-min': observed = Math.min(...values.map(Math.abs)); break;
    case 'min':     observed = Math.min(...values); break;
    case 'max':     observed = Math.max(...values); break;
  }
  let ok = false;
  switch (a.op) {
    case 'abs-max':
    case 'max':
      ok = observed <= a.value; break;
    case 'abs-min':
    case 'min':
      ok = observed >= a.value; break;
  }
  return {
    ok,
    type: a.type,
    description: desc,
    detail: `${a.op}(${a.fiducial}.${a.axis}) = ${observed.toFixed(4)} vs threshold ${a.value} (${ok ? 'pass' : 'fail'})`,
  };
}
