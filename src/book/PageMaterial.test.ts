/**
 * PageMaterial.test.ts — smoke + mutation-killing tests for the legacy
 * page-material factory.
 *
 * Status: this module is unused by the active renderer (Book.ts uses an
 * inline FLIP_VERT shader, see CLAUDE.md → "Legacy"). Tests here exist
 * only to support a non-zero mutation score on the file and to ensure
 * the API stays in working order should the factory be reactivated.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createPageMaterial,
  updateCurlAxis,
  updatePageTextures,
} from './PageMaterial';

function makeTexture(): THREE.Texture {
  const t = new THREE.Texture();
  t.needsUpdate = true;
  return t;
}

describe('PageMaterial.createPageMaterial', () => {
  it('returns a ShaderMaterial with the expected uniforms, double-sided', () => {
    const front = makeTexture();
    const back = makeTexture();
    const next = makeTexture();
    const mat = createPageMaterial({
      frontTexture: front,
      backTexture: back,
      nextPageTexture: next,
      pageWidth: 1.5,
      curlRadius: 0.25,
    });
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.transparent).toBe(false);
    expect(mat.uniforms.pageWidth.value).toBe(1.5);
    expect(mat.uniforms.curlAxisX.value).toBe(1.5);
    expect(mat.uniforms.curlRadius.value).toBe(0.25);
    expect(mat.uniforms.frontTexture.value).toBe(front);
    expect(mat.uniforms.backTexture.value).toBe(back);
    expect(mat.uniforms.nextPageTexture.value).toBe(next);
  });

  it('defaults pageWidth and curlRadius when omitted', () => {
    const mat = createPageMaterial({
      frontTexture: makeTexture(),
      backTexture: makeTexture(),
      nextPageTexture: makeTexture(),
    });
    expect(mat.uniforms.pageWidth.value).toBe(1.0);
    expect(mat.uniforms.curlAxisX.value).toBe(1.0);
    expect(mat.uniforms.curlRadius.value).toBe(0.15);
  });
});

describe('PageMaterial.updateCurlAxis', () => {
  it('sets curlAxisX = pageWidth · cos(phi)', () => {
    const mat = createPageMaterial({
      frontTexture: makeTexture(),
      backTexture: makeTexture(),
      nextPageTexture: makeTexture(),
      pageWidth: 1.0,
    });
    updateCurlAxis(mat, 0, 1.0);
    expect(mat.uniforms.curlAxisX.value).toBeCloseTo(1.0, 9);
    updateCurlAxis(mat, Math.PI / 2, 1.0);
    expect(mat.uniforms.curlAxisX.value).toBeCloseTo(0, 9);
    updateCurlAxis(mat, Math.PI, 1.0);
    expect(mat.uniforms.curlAxisX.value).toBeCloseTo(-1.0, 9);
    updateCurlAxis(mat, Math.PI / 3, 2.0);
    expect(mat.uniforms.curlAxisX.value).toBeCloseTo(2.0 * Math.cos(Math.PI / 3), 9);
  });
});

describe('PageMaterial.updatePageTextures', () => {
  it('replaces all three texture uniforms', () => {
    const mat = createPageMaterial({
      frontTexture: makeTexture(),
      backTexture: makeTexture(),
      nextPageTexture: makeTexture(),
    });
    const newFront = makeTexture();
    const newBack = makeTexture();
    const newNext = makeTexture();
    updatePageTextures(mat, newFront, newBack, newNext);
    expect(mat.uniforms.frontTexture.value).toBe(newFront);
    expect(mat.uniforms.backTexture.value).toBe(newBack);
    expect(mat.uniforms.nextPageTexture.value).toBe(newNext);
  });
});
