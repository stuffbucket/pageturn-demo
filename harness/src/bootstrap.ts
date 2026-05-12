// Page-side bootstrap for the test harness.
// Loads the demo app, then attaches window.__harness so an external driver
// (Playwright) can run scenarios and pull back a captured video blob.
//
// Capture strategy: MediaRecorder on canvas.captureStream(). This records the
// canvas's GPU surface in real time without per-frame ReadPixels, so software
// WebGL (which is what headless Chromium uses without GPU passthrough) doesn't
// tank performance. Tradeoff: events are dispatched in wall-clock time rather
// than virtual time. For frame-perfect deterministic capture, swap in CCapture
// later — the API surface here doesn't need to change.

import '../../src/main.ts';
import type {
  Scenario,
  RunOptions,
  HarnessAPI,
  PointerEventStep,
  TrajectoryResult,
} from './ccapture';
import { FIDUCIAL_US, FIDUCIAL_VS } from '../../src/textures/atlas';
import type { Book } from '../../src/book/Book';

// BOOK_TILT is duplicated from main.ts (kept private there); the trajectory
// math needs to undo this rotation to project page-local positions into
// world space.
const BOOK_TILT = 0.76;
const BEND_AMOUNT = 0.4;
const PAGE_WIDTH = 1.0;
const PAGE_HEIGHT = 1.4;

const READY_DELAY_FRAMES = 4;
const RUNAWAY_MULTIPLIER = 20; // duration * this = abort deadline

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(): Promise<void> {
  for (let i = 0; i < READY_DELAY_FRAMES; i++) await nextFrame();
}

function getCanvas(): HTMLCanvasElement {
  const c = document.querySelector('#canvas-container canvas') as HTMLCanvasElement | null;
  if (!c) throw new Error('harness: canvas not found inside #canvas-container');
  return c;
}

function dispatchPointer(canvas: HTMLCanvasElement, ev: PointerEventStep): void {
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + ev.x * rect.width;
  const clientY = rect.top + ev.y * rect.height;
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    pointerType: 'mouse',
    pointerId: 1,
    isPrimary: true,
    button: 0,
    buttons: ev.type === 'pointerup' ? 0 : 1,
  };
  canvas.dispatchEvent(new PointerEvent(ev.type, init));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`harness timeout: ${label} after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return 'video/webm';
}

async function runScenarioInner(
  scenario: Scenario,
  opts: RunOptions,
): Promise<{ base64: string; mimeType: string }> {
  const fps = opts.fps ?? scenario.fps ?? 30;
  const canvas = getCanvas();

  console.log(`[harness] starting "${scenario.name}" fps=${fps} duration=${scenario.duration}ms`);

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not available in this browser');
  }
  if (typeof (canvas as unknown as { captureStream?: () => MediaStream }).captureStream !== 'function') {
    throw new Error('canvas.captureStream() is not available');
  }

  const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream })
    .captureStream(fps);
  const mimeType = pickMimeType();
  const chunks: Blob[] = [];
  // ~4 Mbps gives near-lossless quality at our 640x360 / ~15-30fps target.
  // VP9 will not exceed what the content needs, so this is an upper bound,
  // not a fixed rate — quiet/static frames still compress aggressively.
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();

  // Scenario keyframes are typically sparse (e.g. one every 100ms). Real human
  // pointermove input fires at 60-120Hz, so the drag handler in main.ts gets
  // smooth progress. Replaying sparse keyframes verbatim makes the turn jump in
  // chunky 100ms steps. Densify by linearly interpolating extra pointermove
  // events between consecutive keyframes, at INTERP_STEP_MS resolution.
  const INTERP_STEP_MS = 8; // ~120Hz, matches a high-rate trackpad/mouse
  const keyframes = [...scenario.events].sort((a, b) => a.t - b.t);
  const dense: PointerEventStep[] = [];
  for (let k = 0; k < keyframes.length; k++) {
    const cur = keyframes[k];
    dense.push(cur);
    const next = keyframes[k + 1];
    // Only interpolate between two consecutive moves (or a down→move pair).
    // Don't fabricate moves across pointerup/down boundaries.
    if (
      !next ||
      next.type === 'pointerdown' ||
      cur.type === 'pointerup'
    ) continue;
    const span = next.t - cur.t;
    if (span <= INTERP_STEP_MS) continue;
    const steps = Math.floor(span / INTERP_STEP_MS);
    for (let s = 1; s < steps; s++) {
      const u = s / steps;
      dense.push({
        t: cur.t + s * (span / steps),
        type: 'pointermove',
        x: cur.x + (next.x - cur.x) * u,
        y: cur.y + (next.y - cur.y) * u,
      });
    }
  }

  const t0 = performance.now();
  for (const ev of dense) {
    const elapsed = performance.now() - t0;
    const wait = ev.t - elapsed;
    if (wait > 0) await sleep(wait);
    dispatchPointer(canvas, ev);
  }
  const remaining = scenario.duration - (performance.now() - t0);
  if (remaining > 0) await sleep(remaining);

  // Request a final dataavailable chunk before stopping so we don't lose
  // the tail of the recording on some MediaRecorder implementations.
  recorder.requestData();
  recorder.stop();
  await withTimeout(stopped, 5_000, 'MediaRecorder.stop');

  const blob = new Blob(chunks, { type: mimeType });
  console.log(`[harness] recorded ${chunks.length} chunks, ${blob.size} bytes`);
  if (blob.size === 0) throw new Error('harness: MediaRecorder produced an empty blob');

  const base64 = await blobToBase64(blob);
  return { base64, mimeType };
}

async function runScenario(
  scenario: Scenario,
  opts: RunOptions = {},
): Promise<{ base64: string; mimeType: string }> {
  const deadline = scenario.duration * RUNAWAY_MULTIPLIER;
  return withTimeout(runScenarioInner(scenario, opts), deadline, `runScenario(${scenario.name})`);
}

/**
 * Compute world-space position of a fiducial on the turning right-page,
 * using the same math as the FLIP_VERT shader plus the book-group X tilt.
 *
 *   t          = u                       (0 at spine, 1 at free edge)
 *   uAngle     = -bookState.phi          (BookState stores |phi|; the
 *                                         shader convention is negative)
 *   phi_v      = uAngle + 0.4 * t * sin(2 * uAngle)
 *   local x'   = origX * cos(phi_v)
 *   local z'   = -origX * sin(phi_v)
 *   local y    = (v - 0.5) * pageHeight
 *   world      = Rx(-BOOK_TILT) * (x', y, z')
 */
function fiducialWorldPosition(
  uAngle: number,
  u: number,
  v: number,
): { x: number; y: number; z: number } {
  const origX = u * PAGE_WIDTH;
  const phi = uAngle + BEND_AMOUNT * u * Math.sin(2 * uAngle);
  const localX = origX * Math.cos(phi);
  const localZ = -origX * Math.sin(phi);
  const localY = (v - 0.5) * PAGE_HEIGHT;
  // Rotate around X by -BOOK_TILT: (y, z) -> (y*cos - z*sin, y*sin + z*cos)
  const c = Math.cos(-BOOK_TILT);
  const s = Math.sin(-BOOK_TILT);
  const worldY = localY * c - localZ * s;
  const worldZ = localY * s + localZ * c;
  return { x: localX, y: worldY, z: worldZ };
}

async function runScenarioTrajectoriesInner(
  scenario: Scenario,
  opts: RunOptions,
): Promise<TrajectoryResult> {
  const fps = opts.fps ?? scenario.fps ?? 30;
  const frameInterval = 1000 / fps;
  const canvas = getCanvas();
  const pt = (window as unknown as { __pageturn?: { book: Book } }).__pageturn;
  if (!pt?.book) throw new Error('harness: window.__pageturn.book is not available');
  const book = pt.book;

  console.log(`[harness:trajectories] "${scenario.name}" fps=${fps} duration=${scenario.duration}ms`);

  // Densify keyframes the same way runScenarioInner does.
  const INTERP_STEP_MS = 8;
  const keyframes = [...scenario.events].sort((a, b) => a.t - b.t);
  const dense: PointerEventStep[] = [];
  for (let k = 0; k < keyframes.length; k++) {
    const cur = keyframes[k];
    dense.push(cur);
    const next = keyframes[k + 1];
    if (!next || next.type === 'pointerdown' || cur.type === 'pointerup') continue;
    const span = next.t - cur.t;
    if (span <= INTERP_STEP_MS) continue;
    const steps = Math.floor(span / INTERP_STEP_MS);
    for (let s = 1; s < steps; s++) {
      const u = s / steps;
      dense.push({
        t: cur.t + s * (span / steps),
        type: 'pointermove',
        x: cur.x + (next.x - cur.x) * u,
        y: cur.y + (next.y - cur.y) * u,
      });
    }
  }

  // Initialise fiducial trajectory arrays.
  const fiducials: Record<string, number[][]> = {};
  for (let i = 0; i < FIDUCIAL_US.length; i++) {
    for (let j = 0; j < FIDUCIAL_VS.length; j++) {
      fiducials[`P_${i}_${j}`] = [];
    }
  }

  function sampleFrame(tMs: number): void {
    const state = book.getState();
    if (!state.getIsTurning()) return;
    // BookState.phi is the magnitude in [0, π]; the shader uAngle is the
    // negative of that for both forward and reverse turns (see FLIP_VERT).
    const uAngle = -state.getRotationAngle();
    for (let i = 0; i < FIDUCIAL_US.length; i++) {
      for (let j = 0; j < FIDUCIAL_VS.length; j++) {
        const u = FIDUCIAL_US[i];
        const v = FIDUCIAL_VS[j];
        const p = fiducialWorldPosition(uAngle, u, v);
        fiducials[`P_${i}_${j}`].push([tMs, p.x, p.y, p.z]);
      }
    }
  }

  const t0 = performance.now();
  let nextSample = 0;
  let evIdx = 0;
  // Drive the loop frame-by-frame: dispatch any events whose t has elapsed,
  // then sample at the fps cadence.
  while (true) {
    const elapsed = performance.now() - t0;
    while (evIdx < dense.length && dense[evIdx].t <= elapsed) {
      dispatchPointer(canvas, dense[evIdx]);
      evIdx++;
    }
    if (elapsed >= nextSample) {
      sampleFrame(elapsed);
      nextSample += frameInterval;
    }
    if (elapsed >= scenario.duration && evIdx >= dense.length) break;
    await nextFrame();
  }

  // Count non-empty fiducials for a sanity log.
  let totalSamples = 0;
  for (const k of Object.keys(fiducials)) totalSamples += fiducials[k].length;
  console.log(`[harness:trajectories] sampled ${totalSamples} fiducial points across ${Object.keys(fiducials).length} markers`);

  return {
    scenario: scenario.name,
    viewport: scenario.viewport,
    fiducials,
  };
}

async function runScenarioTrajectories(
  scenario: Scenario,
  opts: RunOptions = {},
): Promise<TrajectoryResult> {
  const deadline = scenario.duration * RUNAWAY_MULTIPLIER;
  return withTimeout(
    runScenarioTrajectoriesInner(scenario, opts),
    deadline,
    `runScenarioTrajectories(${scenario.name})`,
  );
}

const api: HarnessAPI = {
  ready: waitForReady(),
  runScenario,
  runScenarioTrajectories,
};

window.__harness = api;
