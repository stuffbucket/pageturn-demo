// Shared types for the harness (page-side and runner-side).
//
// File is named ccapture.d.ts for historical reasons — initial implementation
// used CCapture.js for frame-perfect capture. The current implementation uses
// MediaRecorder on canvas.captureStream(), which is faster on software WebGL
// (headless Chromium without GPU passthrough). CCapture is kept in mind as a
// future toggle for deterministic per-frame capture.
declare global {
  interface Window {
    __harness?: HarnessAPI;
  }
}

export interface PointerEventStep {
  t: number;
  type: 'pointerdown' | 'pointermove' | 'pointerup';
  x: number;
  y: number;
}

/**
 * Dispatch a synthesized non-pointer event on the canvas at scenario time `t`.
 * Used to simulate browser-initiated events that no real user gesture
 * sequence can produce (e.g. `lostpointercapture` when the cursor is
 * dragged out of the OS window).
 */
export interface RawEventStep {
  t: number;
  type: 'raw-event';
  /** DOM event name to dispatch, e.g. 'lostpointercapture' or 'pointercancel'. */
  event: string;
}

export type ScenarioStep = PointerEventStep | RawEventStep;

export type Assertion =
  | TelemetryAssertion
  | FileExistsAssertion
  | PixelLumaAssertion
  | PixelMaxLumaAssertion
  | PixelVarianceAssertion
  | PixelEdgeTransitionsAssertion
  | TrajectoryAssertion;

/**
 * Match the first telemetry event whose `type` equals `event`. Optionally
 * require all keys in `where` to deep-equal the event payload. If
 * `afterEventAtT` is set, only events emitted >= that scenario time are
 * considered. If `withinMsAfterT` is set, the matched event must occur
 * within that many ms of `afterEventAtT`.
 */
export interface TelemetryAssertion {
  type: 'telemetry-event';
  event: string;
  where?: Record<string, unknown>;
  afterEventAtT?: number;
  withinMsAfterT?: number;
  /** Optional human description for failure reporting. */
  description?: string;
}

/**
 * Assert that at least one file matching `glob` (anchored at repo root)
 * exists on disk. Accepts a list of acceptable extensions to make the
 * scenario robust to format changes (e.g. .jpg → .png).
 */
export interface FileExistsAssertion {
  type: 'file-exists-glob';
  /** Path glob relative to repo root, e.g. 'contrib/screenshots/harness-*'. */
  glob: string;
  /** Acceptable extensions, e.g. ['.png', '.jpg']. Empty = any. */
  extensions?: string[];
  /** If set, also check that at least one matching file's sidecar
   * (<file>.json) contains JSON whose `sessionId` equals this value. */
  sidecarSessionId?: string;
  description?: string;
}

/**
 * Take a Playwright screenshot at scenario time `atT`, then assert that the
 * mean luma of a rectangular region (in canvas-fraction coordinates, like
 * pointer events) is at least `minMeanLuma`. Used to verify that a region
 * which should contain page pixels is actually showing them.
 */
export interface PixelLumaAssertion {
  type: 'pixel-min-luma';
  atT: number;
  region: { x: number; y: number; w: number; h: number };
  minMeanLuma: number; // 0..255
  description?: string;
}

/**
 * Take a Playwright screenshot at scenario time `atT`, then assert that the
 * mean luma of a rectangular region (in canvas-fraction coordinates, like
 * pointer events) is at most `maxMeanLuma`. The inverse of pixel-min-luma:
 * used to verify that a region which should NOT contain bright pixels (e.g.
 * a back-facing surface that should render its dark back texture, not bleed
 * through to the bright front texture) actually stays dark.
 */
export interface PixelMaxLumaAssertion {
  type: 'pixel-max-luma';
  atT: number;
  region: { x: number; y: number; w: number; h: number };
  maxMeanLuma: number; // 0..255
  description?: string;
}

/**
 * Take a Playwright screenshot at scenario time `atT`, then compute the
 * mean absolute pixel-to-pixel delta across adjacent pixels within the
 * region. Z-fighting / bleed-through tends to produce high-variance
 * stripes; clean rendering produces low variance. Assert variance below
 * `maxMeanAdjacentDelta` (typical clean: <12 in 0..255 luma units).
 */
export interface PixelVarianceAssertion {
  type: 'pixel-max-variance';
  atT: number;
  region: { x: number; y: number; w: number; h: number };
  maxMeanAdjacentDelta: number;
  description?: string;
}

/**
 * Take a screenshot at scenario time `atT`, then count adjacent-pixel
 * luma transitions exceeding `lumaDeltaThreshold` along `axis` ('h' for
 * horizontal pairs, 'v' for vertical pairs). Assert the total over the
 * region is within `[minTransitions, maxTransitions]` (either bound is
 * optional).
 *
 * Use `maxTransitions` when smooth surfaces are expected — a sawtooth /
 * houndstooth boundary inflates the count.  Use `minTransitions` when a
 * regression flattens a sharp boundary into chunky blobs — the per-vertex
 * z-fighting fixed by PR #33 produces FEWER crisp edges in the harness'
 * SwiftShader render than the smoothstep-blended fix does, so the
 * regression detector for that bug is a `minTransitions` bound.
 */
export interface PixelEdgeTransitionsAssertion {
  type: 'pixel-edge-transitions';
  atT: number;
  region: { x: number; y: number; w: number; h: number };
  /** Adjacent-pixel luma delta to count as an "edge transition" (0..255). */
  lumaDeltaThreshold: number;
  /** Maximum total transitions over the entire region (optional). */
  maxTransitions?: number;
  /** Minimum total transitions over the entire region (optional). */
  minTransitions?: number;
  /** 'h' = walk left→right within each row; 'v' = walk top→bottom within each col. */
  axis: 'h' | 'v';
  description?: string;
}

/**
 * Run the scenario in trajectory mode and assert that the recorded
 * fiducial position satisfies a constraint. `fiducial` is a key from the
 * `fiducials` map (e.g. `P_0_3` is i=0, j=3). `axis` is which world-space
 * coordinate to check. The constraint runs over the entire trajectory
 * unless `atTApprox` is set, in which case the closest sample is used.
 */
export interface TrajectoryAssertion {
  type: 'trajectory';
  fiducial: string;
  axis: 'x' | 'y' | 'z';
  /** Required: bound type. */
  op: 'abs-max' | 'abs-min' | 'min' | 'max';
  /** Threshold compared against the chosen op result. */
  value: number;
  /** Optional: only consider the sample closest to this scenario time (ms). */
  atTApprox?: number;
  description?: string;
}

export interface Scenario {
  name: string;
  viewport: { width: number; height: number };
  duration: number;
  fps: number;
  events: ScenarioStep[];
  /** Optional URL override (default: $HARNESS_URL). Useful for ?capture=1 etc. */
  url?: string;
  /** Optional regression assertions evaluated by the runner after replay. */
  assertions?: Assertion[];
  /** If set, run trajectory mode in addition to recording telemetry. */
  trajectories?: boolean;
  /**
   * If true, composite a synthesized mouse-cursor marker on top of the
   * WebGL canvas in the recorded video. The marker tracks the most recent
   * dispatched pointer event. Used to produce review evidence that shows
   * mouse position alongside page-turn behavior. Costs one extra 2D
   * canvas + per-frame drawImage; recording fps drops a few fps on
   * software WebGL but stays smooth.
   */
  cursorOverlay?: boolean;
}

export interface RunOptions {
  fps?: number;
  format?: 'webm';
  quality?: number;
}

export interface TrajectorySample {
  /** Time in ms since the start of the scenario. */
  t: number;
  /** World-space x coordinate. */
  x: number;
  /** World-space y coordinate. */
  y: number;
  /** World-space z coordinate. */
  z: number;
}

export interface TrajectoryResult {
  scenario: string;
  viewport: { width: number; height: number };
  /** Map of fiducial id "P_i_j" -> sequence of [t_ms, x, y, z] tuples. */
  fiducials: Record<string, number[][]>;
}

export interface HarnessAPI {
  ready: Promise<void>;
  runScenario: (scenario: Scenario, opts?: RunOptions) => Promise<{ base64: string; mimeType: string }>;
  /**
   * Replay a scenario and, on each sampled frame, record world-space
   * positions of all 5x7 fiducial markers on the turning page.
   */
  runScenarioTrajectories: (scenario: Scenario, opts?: RunOptions) => Promise<TrajectoryResult>;
  /**
   * Replay a scenario without video capture. Returns the elapsed event
   * timeline and any telemetry events captured by the bootstrap-installed
   * interceptors. Used by assertion-only scenarios.
   */
  runScenarioPlain?: (scenario: Scenario) => Promise<PlainResult>;
  /** Drain captured telemetry without running a scenario. */
  drainTelemetry?: () => CapturedTelemetryEvent[];
  /** Pause until scenario time `atT` ms; resolves when reached. Used by
   * the runner to coordinate Playwright screenshots with scenario time. */
  waitUntilT?: (tMs: number) => Promise<void>;
}

export interface CapturedTelemetryEvent {
  /** Scenario-relative time in ms (0 = start of replay). */
  tScenarioMs: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface PlainResult {
  scenario: string;
  durationMs: number;
  telemetry: CapturedTelemetryEvent[];
  trajectories?: TrajectoryResult;
}

export {};
