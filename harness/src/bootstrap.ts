// Page-side bootstrap for the test harness.
// Loads the demo app, then attaches window.__harness so an external driver
// (Playwright) can run scenarios and pull back a captured video blob.

import '../../src/main.ts';
import type { Scenario, RunOptions, HarnessAPI, PointerEventStep } from './ccapture';

const READY_DELAY_FRAMES = 4;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
      // strip "data:<mime>;base64," prefix
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function runScenario(
  scenario: Scenario,
  opts: RunOptions = {}
): Promise<{ base64: string; mimeType: string }> {
  const fps = opts.fps ?? scenario.fps ?? 60;
  const quality = opts.quality ?? 90;
  const canvas = getCanvas();

  const capturer = new window.CCapture({
    format: opts.format ?? 'webm',
    framerate: fps,
    quality,
    verbose: false,
    display: false,
    name: scenario.name,
  });

  // Sort events by time so the cursor through them is monotonic.
  const events = [...scenario.events].sort((a, b) => a.t - b.t);
  let nextEventIdx = 0;
  const totalMs = scenario.duration;
  const frameMs = 1000 / fps;
  const totalFrames = Math.ceil(totalMs / frameMs);

  capturer.start();

  // We drive simulation time deterministically: each frame advances by frameMs,
  // and any events whose timestamp has passed get dispatched before the capture
  // grabs that frame. This decouples scenario timing from wall clock.
  for (let f = 0; f < totalFrames; f++) {
    const virtualNow = f * frameMs;
    while (nextEventIdx < events.length && events[nextEventIdx].t <= virtualNow) {
      dispatchPointer(canvas, events[nextEventIdx]);
      nextEventIdx++;
    }
    // Let the app render this frame. We rely on the existing rAF loop set up
    // by main.ts to redraw; one rAF tick is enough for synchronous changes.
    await nextFrame();
    capturer.capture(canvas);
  }

  capturer.stop();

  const blob: Blob = await new Promise((resolve) => {
    capturer.save((b: Blob) => resolve(b));
  });
  const base64 = await blobToBase64(blob);
  return { base64, mimeType: blob.type || 'video/webm' };
}

const api: HarnessAPI = {
  ready: waitForReady(),
  runScenario,
};

window.__harness = api;
