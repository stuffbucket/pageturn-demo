/**
 * PageMaterial.ts - ShaderMaterial with curl uniforms from Section 7.3-7.4
 */

import * as THREE from 'three';
import vertexShaderSource from '../shaders/page.vert?raw';
import fragmentShaderSource from '../shaders/page.frag?raw';

export interface PageMaterialParams {
  frontTexture: THREE.Texture;
  backTexture: THREE.Texture;
  nextPageTexture: THREE.Texture;
  pageWidth?: number;
  curlRadius?: number;
}

/**
 * Create a ShaderMaterial for page curl rendering
 */
export function createPageMaterial(params: PageMaterialParams): THREE.ShaderMaterial {
  const {
    frontTexture,
    backTexture,
    nextPageTexture,
    pageWidth = 1.0,
    curlRadius = 0.15,
  } = params;

  return new THREE.ShaderMaterial({
    uniforms: {
      curlAxisX: { value: pageWidth },    // sweeps from pageWidth to -pageWidth
      curlRadius: { value: curlRadius },  // cylinder radius
      pageWidth: { value: pageWidth },
      frontTexture: { value: frontTexture },
      backTexture: { value: backTexture },
      nextPageTexture: { value: nextPageTexture },
    },
    vertexShader: vertexShaderSource,
    fragmentShader: fragmentShaderSource,
    side: THREE.DoubleSide,  // critical: both front and back faces must render
    transparent: false,
  });
}

/**
 * Update the curl axis position based on turn angle
 * @param material The page material
 * @param phi Rotation angle in radians [0, PI]
 * @param pageWidth Page width
 */
export function updateCurlAxis(
  material: THREE.ShaderMaterial,
  phi: number,
  pageWidth: number
): void {
  const curlAxisX = pageWidth * Math.cos(phi);
  (material.uniforms.curlAxisX as THREE.IUniform<number>).value = curlAxisX;
}

/**
 * updatePageTextures - Update page textures
 * @param material The page material
 * @param frontTexture New front texture
 * @param backTexture New back texture
 * @param nextPageTexture New next page texture
 */
export function updatePageTextures(
  material: THREE.ShaderMaterial,
  frontTexture: THREE.Texture,
  backTexture: THREE.Texture,
  nextPageTexture: THREE.Texture
): void {
  (material.uniforms.frontTexture as THREE.IUniform<THREE.Texture>).value = frontTexture;
  (material.uniforms.backTexture as THREE.IUniform<THREE.Texture>).value = backTexture;
  (material.uniforms.nextPageTexture as THREE.IUniform<THREE.Texture>).value = nextPageTexture;
}
