// Minimal ambient types for CCapture.js loaded as a global via <script> tag.
// See: https://github.com/spite/ccapture.js
declare global {
  interface CCaptureOptions {
    format?: 'webm' | 'gif' | 'png' | 'jpg' | 'ffmpegserver' | 'webm-mediarecorder';
    framerate?: number;
    quality?: number;
    name?: string;
    motionBlurFrames?: number;
    verbose?: boolean;
    display?: boolean;
    timeLimit?: number;
    autoSaveTime?: number;
  }

  class CCapture {
    constructor(options: CCaptureOptions);
    start(): void;
    capture(canvas: HTMLCanvasElement): void;
    stop(): void;
    save(callback?: (blob: Blob) => void): void;
  }

  interface Window {
    CCapture: typeof CCapture;
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

export interface HarnessAPI {
  ready: Promise<void>;
  runScenario: (scenario: Scenario, opts?: RunOptions) => Promise<{ base64: string; mimeType: string }>;
}

export {};
