/**
 * Tests for src/camera-presets.ts.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_PRESET_NAMES,
  CAMERA_PRESETS,
  applyCameraPreset,
  cameraPresetFromUrl,
  isCameraPresetName,
} from './camera-presets';

describe('camera-presets', () => {
  it('lists all eight presets in CAMERA_PRESET_NAMES', () => {
    expect(CAMERA_PRESET_NAMES).toHaveLength(8);
    for (const n of CAMERA_PRESET_NAMES) {
      expect(CAMERA_PRESETS[n]).toBeTruthy();
    }
  });

  it('isCameraPresetName accepts known and rejects unknown', () => {
    for (const n of CAMERA_PRESET_NAMES) expect(isCameraPresetName(n)).toBe(true);
    expect(isCameraPresetName('garbage')).toBe(false);
    expect(isCameraPresetName('')).toBe(false);
    expect(isCameraPresetName('FRONT')).toBe(false); // case-sensitive
  });

  it('cameraPresetFromUrl defaults to front when missing/empty/unknown', () => {
    expect(cameraPresetFromUrl({ search: '' })).toBe('front');
    expect(cameraPresetFromUrl({ search: '?other=1' })).toBe('front');
    expect(cameraPresetFromUrl({ search: '?camera=' })).toBe('front');
    expect(cameraPresetFromUrl({ search: '?camera=garbage' })).toBe('front');
  });

  it('cameraPresetFromUrl parses each known preset', () => {
    for (const n of CAMERA_PRESET_NAMES) {
      expect(cameraPresetFromUrl({ search: `?camera=${n}` })).toBe(n);
    }
  });

  it('applyCameraPreset writes position + target and reorients camera', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const tgt = new THREE.Vector3(99, 99, 99);

    applyCameraPreset(cam, tgt, 'top');
    expect(cam.position.x).toBeCloseTo(0);
    expect(cam.position.y).toBeCloseTo(2.6);
    expect(tgt.equals(new THREE.Vector3(0, 0, 0))).toBe(true);

    applyCameraPreset(cam, tgt, 'front');
    expect(cam.position.toArray()).toEqual([0, 0.6, 2.6]);

    applyCameraPreset(cam, tgt, 'iso');
    // Equal-axis camera distance = sqrt(3 * 1.5^2) ≈ 2.598
    const r = cam.position.length();
    expect(r).toBeCloseTo(Math.sqrt(3) * 1.5, 5);
  });

  it('every preset has a non-empty description (so index.html has narrative)', () => {
    for (const n of CAMERA_PRESET_NAMES) {
      expect(CAMERA_PRESETS[n].description.length).toBeGreaterThan(20);
    }
  });

  it('non-front presets place the camera at a different pose than front', () => {
    const cam = new THREE.PerspectiveCamera();
    const tgt = new THREE.Vector3();
    applyCameraPreset(cam, tgt, 'front');
    const frontPos = cam.position.clone();
    for (const n of CAMERA_PRESET_NAMES) {
      if (n === 'front') continue;
      applyCameraPreset(cam, tgt, n);
      expect(cam.position.distanceTo(frontPos)).toBeGreaterThan(0.5);
    }
  });
});
