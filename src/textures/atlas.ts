/**
 * atlas.ts - Texture atlas and page texture generation from Section 7.6 and 9
 */

import * as THREE from 'three';

export interface PageTextureInfo {
  texture: THREE.Texture;
  index: number;
  label: string;
}

/**
 * Generate a simple test texture for a page with page number and label
 * @param label Text to display (page number, "Cover", etc.)
 * @param width Canvas width
 * @param height Canvas height
 * @param backgroundColor Background color hex string
 * @param textColor Text color hex string
 */
export function generatePageTexture(
  label: string,
  width: number = 512,
  height: number = 512,
  backgroundColor: string = '#f5f5f0',
  textColor: string = '#333333'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context from canvas');
  }

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Border
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Text: page label
  ctx.fillStyle = textColor;
  ctx.font = `bold ${Math.max(48, width / 8)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2 - 40);

  // Subtitle
  ctx.font = `${Math.max(24, width / 20)}px serif`;
  ctx.fillStyle = '#999999';
  ctx.fillText('Demo Page', width / 2, height / 2 + 40);

  // Small corner numbers
  ctx.font = `${Math.max(12, width / 50)}px monospace`;
  ctx.fillStyle = '#cccccc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, 10, 10);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, width - 10, height - 10);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

/**
 * Generate textures for a complete book
 * Front cover, back cover, and all interior pages
 * 
 * @param numPages Number of interior pages (2n from the formalization)
 * @param textureSize Size of each texture (width x height)
 */
export function generateBookTextures(
  numPages: number,
  textureSize: number = 512
): Map<string, THREE.Texture> {
  const textures = new Map<string, THREE.Texture>();

  // Covers
  textures.set('cover_front_ext', generatePageTexture(
    'Front Cover',
    textureSize,
    textureSize,
    '#8B4513',  // brown for cover
    '#F5DEB3'
  ));

  textures.set('cover_front_int', generatePageTexture(
    'Inside Front',
    textureSize,
    textureSize,
    '#f5f5f0',
    '#333333'
  ));

  textures.set('cover_back_int', generatePageTexture(
    'Inside Back',
    textureSize,
    textureSize,
    '#f5f5f0',
    '#333333'
  ));

  textures.set('cover_back_ext', generatePageTexture(
    'Back Cover',
    textureSize,
    textureSize,
    '#8B4513',
    '#F5DEB3'
  ));

  // Interior pages
  for (let i = 1; i <= numPages; i++) {
    const label = `Page ${i}`;
    const bgColor = i % 2 === 0 ? '#fffaf0' : '#f5f5f0'; // alternating cream shades
    textures.set(`p${i}`, generatePageTexture(
      label,
      textureSize,
      textureSize,
      bgColor,
      '#333333'
    ));
  }

  return textures;
}
