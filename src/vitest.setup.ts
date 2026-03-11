/**
 * Vitest setup file - Configure test environment and global mocks
 * This file is loaded before test files, so mocks are set up first
 */

import { vi } from 'vitest';

// Mock canvas 2D context globally before any Three.js imports
if (typeof HTMLCanvasElement !== 'undefined') {
  const mockContext2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: 'Arial',
    textAlign: 'left' as const,
    textBaseline: 'top' as const,
    globalAlpha: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
    })),
    createImageData: vi.fn(),
    putImageData: vi.fn(),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createPattern: vi.fn(() => ({ })),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    isPointInPath: vi.fn(() => false),
    isPointInStroke: vi.fn(() => false),
    canvas: { width: 512, height: 512 },
  } as unknown as CanvasRenderingContext2D;

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: any
  ): any {
    if (contextId === '2d') {
      return mockContext2D;
    }
    return originalGetContext.call(this, contextId, options);
  };
}

