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
import type { Scenario, RunOptions, HarnessAPI, PointerEventStep } from './ccapture';

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
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();

  const events = [...scenario.events].sort((a, b) => a.t - b.t);
  const t0 = performance.now();
  let i = 0;
  while (i < events.length) {
    const ev = events[i];
    const elapsed = performance.now() - t0;
    const wait = ev.t - elapsed;
    if (wait > 0) await sleep(wait);
    dispatchPointer(canvas, ev);
    i++;
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

const api: HarnessAPI = {
  ready: waitForReady(),
  runScenario,
};

window.__harness = api;
