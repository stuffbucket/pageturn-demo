/**
 * long-press-capture.ts — Browser-side half of the long-press screenshot
 * capture system.
 *
 * When the user holds the primary mouse/pointer button down on the canvas
 * for >= HOLD_THRESHOLD_MS without moving more than MOVE_TOLERANCE_PX, this
 * module:
 *
 *   1. Grabs the WebGL canvas as a JPEG data URL.
 *   2. POSTs a structured payload (image + telemetry snapshot) to the
 *      sibling Vite plugin endpoint at `/__screenshot`.
 *   3. Flashes the screen white briefly to confirm capture.
 *   4. Emits a `screenshot-captured` telemetry event so log readers can
 *      correlate the screenshot with the surrounding event stream.
 *
 * Gating: this module is only active when the page was loaded with the
 * `?capture=1` URL flag.  `installLongPressCapture` is a no-op otherwise.
 *
 * Session: agents that boot the prototype with `?session=<slug>` (e.g.
 * `?session=spine-tear-investigation-2026-05-12`) get that slug echoed
 * back to the server so screenshots end up in a predictable filename.
 *
 * The JSON schema for the POST body is fixed — see `ScreenshotPayload`
 * below.  The sibling server agent depends on it.
 */

import { emit as emitTelemetry } from './telemetry';

// ── Tunables ────────────────────────────────────────────────────────────────
const HOLD_THRESHOLD_MS = 5000;
const MOVE_TOLERANCE_PX = 4;
const FLASH_DURATION_MS = 250;
const ENDPOINT = '/__screenshot';

// ── State snapshot type (must match what main.ts builds) ────────────────────
export interface StateSnapshot {
  drag: {
    isDragging: boolean;
    dragPoint: { x: number; y: number } | null;
    dragProgress: number;
    dragVelocity: number;
  };
  crease: {
    alpha: number;
    originY: number;
    dihedral: number;
    creaseDir: { x: number; y: number };
    cornerDir: { x: number; y: number };
  };
  turn: {
    j: number;
    phi: number;
    progress: number;
    isTurning: boolean;
    isReverse: boolean;
    settling: boolean;
    settleTarget: number;
  };
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  };
  fps: number;
}

interface ScreenshotPayload {
  imageDataUrl: string;
  clientTimestamp: string;
  url: string;
  sessionId: string | null;
  triggerLocation: { x: number; y: number };
  state: StateSnapshot;
}

interface ScreenshotResponse {
  filename: string;
  path: string;
  sidecarPath?: string;
}

// ── URL flag helpers ────────────────────────────────────────────────────────
export function captureEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('capture') === '1';
  } catch {
    return false;
  }
}

function readSessionId(): string | null {
  if (typeof location === 'undefined') return null;
  try {
    const v = new URLSearchParams(location.search).get('session');
    return v ?? null;
  } catch {
    return null;
  }
}

// ── Flash overlay ───────────────────────────────────────────────────────────
function ensureFlashOverlay(): HTMLDivElement {
  let el = document.querySelector<HTMLDivElement>('.long-press-flash');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'long-press-flash';
  document.body.appendChild(el);
  return el;
}

function fireFlash(el: HTMLDivElement): void {
  // Force layout so the transition fires on add even if we just appended.
  void el.offsetWidth;
  el.classList.add('flashing');
  setTimeout(() => el.classList.remove('flashing'), FLASH_DURATION_MS);
}

// ── Public API ──────────────────────────────────────────────────────────────
/**
 * Install long-press screenshot capture on `canvas`.  No-op unless
 * `?capture=1` is set in the page URL.
 *
 * @param canvas              The WebGL canvas to capture on long-press.
 * @param getStateSnapshot    Closure that returns a fresh StateSnapshot at
 *                            capture time.  Called synchronously from the
 *                            timer callback, so it should be cheap.
 */
export function installLongPressCapture(
  canvas: HTMLCanvasElement,
  getStateSnapshot: () => StateSnapshot,
): void {
  if (!captureEnabled()) return;
  if (typeof window === 'undefined') return;

  const flashEl = ensureFlashOverlay();
  const sessionId = readSessionId();

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let pressActive = false;
  let captureFiredThisPress = false;
  let startClientX = 0;
  let startClientY = 0;
  let startCanvasX = 0;
  let startCanvasY = 0;
  let activePointerId = -1;

  const cancelTimer = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const resetPress = (): void => {
    cancelTimer();
    pressActive = false;
    captureFiredThisPress = false;
    activePointerId = -1;
  };

  const fireCapture = async (): Promise<void> => {
    if (captureFiredThisPress) return;
    captureFiredThisPress = true;
    timerId = null;

    // Visual confirmation immediately — don't wait on the network round-trip.
    fireFlash(flashEl);

    let imageDataUrl: string;
    try {
      imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    } catch (err) {
      // Tainted canvas, OOM, etc. — log and bail without breaking the page.
      // eslint-disable-next-line no-console
      console.warn('[long-press-capture] canvas.toDataURL failed', err);
      return;
    }

    const state = getStateSnapshot();
    const payload: ScreenshotPayload = {
      imageDataUrl,
      clientTimestamp: new Date().toISOString(),
      url: window.location.href,
      sessionId,
      triggerLocation: { x: startCanvasX, y: startCanvasY },
      state,
    };

    let response: ScreenshotResponse | null = null;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        response = (await res.json()) as ScreenshotResponse;
      } else {
        // eslint-disable-next-line no-console
        console.warn('[long-press-capture] server returned', res.status);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[long-press-capture] POST failed', err);
    }

    emitTelemetry('screenshot-captured', {
      triggerLocation: payload.triggerLocation,
      url: payload.url,
      sessionId,
      filename: response?.filename ?? null,
      state,
    });
  };

  // All pointer listeners are registered in the CAPTURE phase as PASSIVE
  // observers (no preventDefault, no stopPropagation).  This is required
  // because main.ts's drag handler is also capture-phase and calls
  // stopImmediatePropagation() when it grabs a page; if we listened in the
  // bubble phase we'd never see pointerdown during a drag, and the hold
  // timer would never start.  See main.ts install ordering note.
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Start fresh — if a previous press was somehow still tracked, drop it.
    resetPress();

    pressActive = true;
    activePointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    const rect = canvas.getBoundingClientRect();
    startCanvasX = e.clientX - rect.left;
    startCanvasY = e.clientY - rect.top;

    timerId = setTimeout(() => { void fireCapture(); }, HOLD_THRESHOLD_MS);
  }, true);

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (!pressActive) return;
    if (e.pointerId !== activePointerId) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
      cancelTimer();
    }
  }, true);

  const endPress = (e: PointerEvent): void => {
    if (!pressActive) return;
    if (e.pointerId !== activePointerId) return;
    resetPress();
  };
  canvas.addEventListener('pointerup', endPress, true);
  canvas.addEventListener('pointercancel', endPress, true);
  // If the canvas loses pointer capture mid-hold (e.g. drag handed off to
  // another listener), treat it as press-end so we never fire after release.
  canvas.addEventListener('lostpointercapture', () => { resetPress(); });
}
