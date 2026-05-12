/**
 * telemetry.ts — In-page client that streams runtime events to the Vite dev
 * server, where the `telemetry-sink` plugin (vite.config.ts) appends each one
 * as a line of JSON to /tmp/pageturn-telemetry.jsonl.
 *
 * Disabled unless the page was loaded with `?telemetry=1`.  Designed so an
 * agent (or human) can `tail -f` the log file to monitor the prototype's
 * behavior without disturbing the user.
 *
 * Transport: prefers `navigator.sendBeacon` (fire-and-forget, non-blocking,
 * survives page unload).  Falls back to `fetch(..., {keepalive: true})`.
 */

const ENDPOINT = '/__telemetry';

let cachedEnabled: boolean | null = null;
let errorListenersInstalled = false;

/** Whether the `?telemetry=1` URL flag is set. */
export function telemetryEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof location === 'undefined') {
    cachedEnabled = false;
    return false;
  }
  try {
    cachedEnabled = new URLSearchParams(location.search).get('telemetry') === '1';
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

// ── Rate limiter for high-frequency event types ────────────────────────────
// pointer-move can fire 100+ Hz on a high-refresh trackpad; throttle so the
// log isn't dominated by them.  Other event types pass through unrate-limited.
const RATE_LIMIT_MS: Record<string, number> = {
  'pointer-move': 100, // ~10 Hz
};
const lastEmitMs: Record<string, number> = {};

/**
 * Emit a telemetry event.  No-op when telemetry is disabled.
 *
 * The Vite middleware stamps each line with an ISO timestamp; we don't send
 * one from the client (avoids client-clock-drift confusion when correlating
 * with server-side logs).
 */
export function emit(eventType: string, payload: Record<string, unknown> = {}): void {
  if (!telemetryEnabled()) return;

  const limit = RATE_LIMIT_MS[eventType];
  if (limit !== undefined) {
    const now = performance.now();
    const last = lastEmitMs[eventType] ?? -Infinity;
    if (now - last < limit) return;
    lastEmitMs[eventType] = now;
  }

  const body = JSON.stringify({ type: eventType, ...payload });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // sendBeacon needs a Blob to set the content type.
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    // Fallback — keepalive lets the request survive a navigation/unload.
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* swallow — telemetry must never throw */ });
  } catch {
    /* swallow — telemetry must never throw */
  }
}

/**
 * Install global `onerror` and `unhandledrejection` listeners that emit
 * `{type: 'error', ...}` events.  Idempotent.  Safe to call when telemetry is
 * disabled (it just won't install anything).
 */
export function installErrorReporting(): void {
  if (errorListenersInstalled) return;
  if (!telemetryEnabled()) return;
  if (typeof window === 'undefined') return;
  errorListenersInstalled = true;

  window.addEventListener('error', (e) => {
    emit('error', {
      message: String(e.message ?? e.error ?? 'unknown'),
      stack: e.error && (e.error as Error).stack ? (e.error as Error).stack : null,
      filename: e.filename ?? null,
      lineno: e.lineno ?? null,
      colno: e.colno ?? null,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack ?? null : null;
    emit('error', { message, stack, source: 'unhandledrejection' });
  });
}

/**
 * Wrap a function so any synchronous throw (or rejected promise return) is
 * reported via telemetry before being re-thrown.  Useful for instrumenting
 * event handlers without changing their signature semantics.
 */
export function withErrorReporting<A extends unknown[], R>(
  fn: (...args: A) => R,
  context?: string,
): (...args: A) => R {
  return (...args: A): R => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack ?? null : null;
          emit('error', { message, stack, context: context ?? null });
          throw err;
        }) as R;
      }
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack ?? null : null;
      emit('error', { message, stack, context: context ?? null });
      throw err;
    }
  };
}
