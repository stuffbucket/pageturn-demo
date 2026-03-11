/**
 * TestUtils.ts - Utilities for testing geometry and rendering
 */

import * as THREE from 'three';

/**
 * Verify that a vertex lies on a cylinder
 * 
 * Given: cylinder axis at x=curlAxisX, radius r
 * Point (x, z) should satisfy: (x - curlAxisX)² + z² ≤ r²
 */
export function verifyPointOnCylinder(
  x: number,
  z: number,
  curlAxisX: number,
  radius: number,
  tolerance: number = 0.01
): boolean {
  const dx = x - curlAxisX;
  const distFromAxis = Math.sqrt(dx * dx + z * z);
  return distFromAxis <= radius + tolerance;
}

/**
 * Compute the bounding box of a geometry
 */
export function getBoundingBox(geometry: THREE.BufferGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < positions.count; i++) {
    minX = Math.min(minX, positions.getX(i));
    maxX = Math.max(maxX, positions.getX(i));
    minY = Math.min(minY, positions.getY(i));
    maxY = Math.max(maxY, positions.getY(i));
    minZ = Math.min(minZ, positions.getZ(i));
    maxZ = Math.max(maxZ, positions.getZ(i));
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * Count vertices in a specific region
 */
export function countVerticesInRegion(
  geometry: THREE.BufferGeometry,
  curlAxisX: number,
  radius: number,
  region: 1 | 2 | 3
): number {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  let count = 0;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const d = x - curlAxisX;

    if (region === 1 && d < 0) count++;
    else if (region === 2 && d >= 0 && d <= Math.PI * radius) count++;
    else if (region === 3 && d > Math.PI * radius) count++;
  }

  return count;
}

/**
 * Verify vertex normal is computed correctly
 */
export function hasNormals(geometry: THREE.BufferGeometry): boolean {
  return geometry.getAttribute('normal') !== undefined;
}

/**
 * Measure the "width" of the curl (distance from curl axis to furthest point)
 */
export function measureCurlWidth(
  geometry: THREE.BufferGeometry,
  curlAxisX: number,
  radius: number
): number {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  let maxWidth = 0;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const d = x - curlAxisX;

    if (d >= 0 && d <= Math.PI * radius) {
      const distFromAxis = Math.sqrt(d * d + z * z);
      maxWidth = Math.max(maxWidth, distFromAxis);
    }
  }

  return maxWidth;
}

/**
 * Compute average/max deformation from original position
 */
export function measureDeformation(
  geometry: THREE.BufferGeometry,
  _curlAxisX: number,
  _radius: number
): {
  averageDistance: number;
  maxDistance: number;
} {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const original = geometry.userData.originalPositions as Float32Array;

  let totalDistance = 0;
  let maxDistance = 0;
  let countVertices = 0;

  for (let i = 0; i < positions.count; i++) {
    const origX = original[i * 3];
    const origY = original[i * 3 + 1];
    const origZ = original[i * 3 + 2];

    const dispX = positions.getX(i);
    const dispY = positions.getY(i);
    const dispZ = positions.getZ(i);

    const dx = dispX - origX;
    const dy = dispY - origY;
    const dz = dispZ - origZ;

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    totalDistance += dist;
    maxDistance = Math.max(maxDistance, dist);
    countVertices++;
  }

  return {
    averageDistance: totalDistance / countVertices,
    maxDistance,
  };
}

/**
 * Verify that arc length is preserved (isometry check)
 */
export function verifyIsometry(
  original: Float32Array,
  displaced: THREE.BufferAttribute,
  curlAxisX: number,
  radius: number
): { isometric: boolean; errors: number[] } {
  const errors: number[] = [];

  const maxD = Math.PI * radius;
  const samplePoints: number[] = [];

  // Collect vertices on cylinder in order
  for (let i = 0; i < displaced.count; i++) {
    const origX = original[i * 3];
    const d = origX - curlAxisX;

    if (d >= 0 && d <= maxD) {
      samplePoints.push(i);
    }
  }

  // Sort by their d values
  samplePoints.sort((i, j) => {
    const di = original[i * 3] - curlAxisX;
    const dj = original[j * 3] - curlAxisX;
    return di - dj;
  });

  // Check consecutive points have similar arc-length spacing
  for (let k = 1; k < samplePoints.length; k++) {
    const i = samplePoints[k - 1];
    const j = samplePoints[k];

    const origDelta = Math.abs(original[j * 3] - original[i * 3]);
    
    const dispI = {
      x: displaced.getX(i),
      z: displaced.getZ(i),
    };
    const dispJ = {
      x: displaced.getX(j),
      z: displaced.getZ(j),
    };

    const dispDelta = Math.sqrt(
      (dispJ.x - dispI.x) ** 2 + (dispJ.z - dispI.z) ** 2
    );

    const error = Math.abs(dispDelta - origDelta);
    errors.push(error);
  }

  const isometric = errors.every((e) => e < 0.05);
  return { isometric, errors };
}

/**
 * Simulate rendering test: verify that curl computation is frame-consistent
 */
export function verifyFrameConsistency(
  createGeometryFn: () => THREE.PlaneGeometry,
  applyCurlFn: (geo: THREE.PlaneGeometry, axis: number, radius: number) => void,
  pageWidth: number,
  numFrames: number = 11
): {
  consistent: boolean;
  variance: number;
} {
  const frames: number[][] = [];

  for (let frame = 0; frame < numFrames; frame++) {
    const progress = frame / (numFrames - 1);
    const phi = progress * Math.PI;
    const curlAxisX = pageWidth * Math.cos(phi);

    const geo = createGeometryFn();
    applyCurlFn(geo, curlAxisX, 0.15);

    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    const frameData: number[] = [];

    // Sample center vertices
    for (let i = 0; i < Math.min(10, positions.count); i++) {
      frameData.push(positions.getX(i));
      frameData.push(positions.getZ(i));
    }

    frames.push(frameData);
  }

  // Check variance - should be smooth progression, not random
  let totalVariance = 0;
  let count = 0;

  for (let i = 1; i < frames.length - 1; i++) {
    for (let j = 0; j < frames[i].length; j++) {
      const prev = frames[i - 1][j];
      const curr = frames[i][j];
      const next = frames[i + 1][j];

      // Second derivative should be small (smoothness)
      const accel = Math.abs((next - curr) - (curr - prev));
      totalVariance += accel;
      count++;
    }
  }

  const variance = totalVariance / count;
  const consistent = variance < 0.01; // Low variance = smooth animation

  return { consistent, variance };
}
