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

export interface Scenario {
  name: string;
  viewport: { width: number; height: number };
  duration: number;
  fps: number;
  events: PointerEventStep[];
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
}

export {};
