/**
 * PageGeometry.ts - Subdivided PlaneGeometry factory from Section 7.2
 */

import * as THREE from 'three';

/**
 * Create a subdivided page geometry
 * The page is a plane with the spine at x=0, extending in +X direction
 * 
 * @param width Page width (W in the formalization)
 * @param height Page height (H in the formalization)
 * @param xSegments Number of segments along X axis (default 32 for smooth curl)
 * @param ySegments Number of segments along Y axis (default 1)
 * @returns PlaneGeometry with spine at x=0
 */
export function createPageGeometry(
  width: number = 1.0,
  height: number = 1.4,
  xSegments: number = 32,
  ySegments: number = 1
): THREE.PlaneGeometry {
  // PlaneGeometry(width, height, widthSegments, heightSegments)
  // Creates a plane in the XY plane, centered at origin
  const geo = new THREE.PlaneGeometry(width, height, xSegments, ySegments);

  // Shift so left edge (spine) is at x=0, page extends to +X
  geo.translate(width / 2, 0, 0);

  // Store original positions for CPU-side displacement (if used)
  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  geo.userData.originalPositions = new Float32Array(positions.array as Float32Array);

  return geo;
}

/**
 * Apply curl displacement to geometry vertices (CPU-side approach from Section 7.3)
 * This is optional - the vertex shader can do this on GPU for better performance
 * 
 * @param geometry The page geometry to modify
 * @param curlAxisX Position of the curl axis along X
 * @param radius Cylinder radius
 */
export function applyCurlDisplacement(
  geometry: THREE.PlaneGeometry,
  curlAxisX: number,
  radius: number
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const original = geometry.userData.originalPositions as Float32Array;

  if (!original) {
    console.warn('No original positions stored. Call this after creating geometry.');
    return;
  }

  for (let i = 0; i < positions.count; i++) {
    const x = original[i * 3];
    const y = original[i * 3 + 1];
    const d = x - curlAxisX;

    let xPrime = x;
    let zPrime = 0;

    if (d < 0) {
      // Case 1: Already turned, mirror across curl axis
      xPrime = 2 * curlAxisX - x;
      zPrime = 0.001; // slight offset to avoid z-fighting
    } else if (d <= Math.PI * radius) {
      // Case 2: On the cylinder
      const theta = d / radius;
      xPrime = curlAxisX + radius * Math.sin(theta);
      zPrime = radius * (1 - Math.cos(theta));
    }
    // Case 3: Ahead of curl, no change

    positions.setXYZ(i, xPrime, y, zPrime);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}
