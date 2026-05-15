/**
 * camera-presets.ts — Multi-angle camera URL flag (`?camera=<preset>`).
 *
 * Supplies camera position + lookAt for diagnosing bugs that are invisible or
 * ambiguous from the default front view. Common use:
 *
 *   import { applyCameraPreset, cameraPresetFromUrl } from './camera-presets';
 *   applyCameraPreset(camera, controls.target, cameraPresetFromUrl());
 *
 * Field of view is intentionally unchanged — switching FOV midway through a
 * comparison sweep would muddy bug-vs-perspective signals.
 *
 * The presets are tuned for the default tilted book (BOOK_TILT ≈ 0.76 rad =
 * ~44°). Distance is held roughly constant at ~2.6 world-units so apparent
 * page size doesn't swing wildly between angles.
 */

import * as THREE from 'three';

export type CameraPresetName =
  | 'front'
  | 'top'
  | 'side-spine'
  | 'side-corner'
  | 'three-quarter'
  | 'worm'
  | 'behind'
  | 'iso';

export const CAMERA_PRESET_NAMES: CameraPresetName[] = [
  'front',
  'top',
  'side-spine',
  'side-corner',
  'three-quarter',
  'worm',
  'behind',
  'iso',
];

export interface CameraPreset {
  /** World-space camera position. */
  position: [number, number, number];
  /** World-space point the camera looks at (also the OrbitControls target). */
  target: [number, number, number];
  /** Short paragraph for `index.html`: what bugs this angle exposes. */
  description: string;
}

/** Default front view — matches the constructor's set(0, 0.6, 2.6). */
const FRONT: CameraPreset = {
  position: [0, 0.6, 2.6],
  target: [0, 0, 0],
  description:
    'The shipping default. Faces the spread head-on. Best for back-face ' +
    'bleed-through (#65) and judging cover gradient continuity. Hides ' +
    'pivot-axis defects and z-axis drift.',
};

/**
 * Top-down ortho-style view. Spine is a vertical line in screen space;
 * any rotation that does NOT pass through x=0 is immediately visible.
 * Camera held above the table; lookAt is the spread center.
 */
const TOP: CameraPreset = {
  position: [0, 2.6, 0.001], // tiny z offset to avoid gimbal-up=lookDir degeneracy
  target: [0, 0, 0],
  description:
    'Top-down. Spine is a vertical line. Off-spine pivot bug (#68/#76) shows ' +
    'as the page rotating around an axis that drifts away from x=0 — the ' +
    'turning page sweeps a banana shape instead of a half-disc.',
};

/**
 * Edge-on along the spine. Camera looks down the +Y spine line so the
 * turning page is seen from its own thickness. Curl-into-tube failure
 * (PR #59 history) reads instantly as a coiled cross-section.
 */
const SIDE_SPINE: CameraPreset = {
  position: [0, 0, 2.6], // straight on Z, no tilt; book tilt then makes spine visible as line
  target: [0, 0, 0],
  description:
    'Side, spine-aligned. The turning page is seen edge-on. Curl-into-tube ' +
    '(PR #59 regression) shows as a coil that winds past pi/2. Z-axis drift ' +
    'shows as the page leaving the camera-plane during settle.',
};

/**
 * Looking from the corner being dragged toward the opposite corner.
 * For the canonical drag in this scenario set (top-right corner), camera
 * sits up-and-right and looks down-and-left.
 */
const SIDE_CORNER: CameraPreset = {
  position: [2.0, 1.6, 1.6],
  target: [0, 0, 0],
  description:
    'Down the drag-axis. Reveals whether the dihedral aligns with the drag ' +
    'direction or hinges off-axis. Useful for diagnosing tilt-vs-direction ' +
    'mismatch (#76 area).',
};

/** Classic 30/45 screenshot angle. */
const THREE_QUARTER: CameraPreset = {
  position: [1.84, 1.3, 1.84], // 30° elevation, 45° azimuth, r ≈ 2.6
  target: [0, 0, 0],
  description:
    'Three-quarter (30 elev, 45 az). Generic "looks like a book" view. ' +
    'Good single-frame thumbnail; shows back-face issues and curl shape ' +
    'simultaneously without exaggerating either.',
};

/**
 * Looking up from below. Useful for back-face inspection without
 * polygon-offset bias hiding the issue.
 */
const WORM: CameraPreset = {
  position: [0, -1.6, 2.0],
  target: [0, 0, 0],
  description:
    'Worm-eye, from below. Reveals back-face texture continuity, n+1 leaf ' +
    'absence (#54/#58), and any pages rendered with the wrong handedness.',
};

/**
 * Behind the book: spine sits between camera and the visible spread.
 * The right page in screen-space is now the *left* page in book-space.
 * Detects mirror-flip bugs in fiducial labeling or texture orientation.
 */
const BEHIND: CameraPreset = {
  position: [0, 0.6, -2.6],
  target: [0, 0, 0],
  description:
    'From behind the book. Confirms whether the back face of the turning ' +
    'page is sampling the correct texture (PR #74 territory). Mirror-flips ' +
    'in atlas labeling become obvious here.',
};

/** Isometric (35.264° elevation, 45° azimuth). */
const ISO: CameraPreset = {
  position: [1.5, 1.5, 1.5], // (1,1,1) normalized * 2.6
  target: [0, 0, 0],
  description:
    'Isometric (35.264 elev, 45 az). Equal foreshortening on all axes — ' +
    'good for measuring relative sizes and for side-by-side comparisons ' +
    'across runs.',
};

export const CAMERA_PRESETS: Record<CameraPresetName, CameraPreset> = {
  front: FRONT,
  top: TOP,
  'side-spine': SIDE_SPINE,
  'side-corner': SIDE_CORNER,
  'three-quarter': THREE_QUARTER,
  worm: WORM,
  behind: BEHIND,
  iso: ISO,
};

/**
 * Read `?camera=<preset>` from the current URL. Returns 'front' if the flag
 * is missing, empty, or unrecognized. Pure-function-like at call time:
 * accepts an optional location override for testability.
 */
export function cameraPresetFromUrl(loc?: { search: string }): CameraPresetName {
  const search = loc?.search ?? (typeof location !== 'undefined' ? location.search : '');
  if (!search) return 'front';
  const params = new URLSearchParams(search);
  const raw = params.get('camera');
  if (!raw) return 'front';
  return isCameraPresetName(raw) ? raw : 'front';
}

/** Type guard. Exposed so harness code can validate user-supplied strings. */
export function isCameraPresetName(s: string): s is CameraPresetName {
  return (CAMERA_PRESET_NAMES as string[]).includes(s);
}

/**
 * Apply a preset to a Three.js camera + OrbitControls target. Keeps FOV and
 * other camera intrinsics untouched. Safe to call at boot before the first
 * render.
 */
export function applyCameraPreset(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  preset: CameraPresetName,
): void {
  const p = CAMERA_PRESETS[preset];
  camera.position.set(p.position[0], p.position[1], p.position[2]);
  target.set(p.target[0], p.target[1], p.target[2]);
  camera.lookAt(target);
}
