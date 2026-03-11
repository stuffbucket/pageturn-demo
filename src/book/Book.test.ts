/**
 * Book.test.ts
 * Integration tests for the complete Book orchestrator
 * Verifies state machine + geometry + texture integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Book } from './Book';

describe('Book - Integration Tests', () => {
  let book: Book;

  beforeEach(() => {
    book = new Book({
      numLeaves: 3,
      pageWidth: 1.0,
      pageHeight: 1.4,
      curlRadius: 0.15,
      textureSize: 256,
    });
  });

  describe('Book Creation', () => {
    it('creates a book with correct number of leaves', () => {
      const state = book.getState();
      expect(state.getTotalStates()).toBe(6); // -1 to 4 for n=3
    });

    it('returns a Three.js Group for scene addition', () => {
      const group = book.getGroup();
      expect(group).toBeInstanceOf(THREE.Group);
      expect(group.children.length).toBeGreaterThan(0);
    });

    it('initializes with front cover showing', () => {
      const description = book.getStateDescription();
      expect(description).toContain('Closed');
      expect(description).toContain('Front');
    });
  });

  describe('Page Turn Animation', () => {
    it('can start a forward turn', () => {
      const result = book.startTurn();
      expect(result).toBe(true);
      expect(book.getState().getIsTurning()).toBe(true);
    });

    it('can start a reverse turn', () => {
      // First go forward
      book.startTurn();
      book.updateTurningPage(1.0);

      const result = book.startReverseTurn();
      expect(result).toBe(true);
      expect(book.getState().getIsTurning()).toBe(true);
    });

    it('updates turning page during animation', () => {
      book.startTurn();

      for (let progress = 0; progress <= 1.0; progress += 0.1) {
        book.updateTurningPage(progress);
        expect(book.getState().getTurningProgress()).toBeCloseTo(progress, 1);
      }
    });

    it('completes turn and cleans up turning page mesh', () => {
      book.startTurn();
      book.updateTurningPage(1.0);

      book.completeTurn();

      expect(book.getState().getIsTurning()).toBe(false);
    });
  });

  describe('State Consistency', () => {
    it('state index advances only after turn completion', () => {
      const stateBefore = book.getState().getStateIndex();

      book.startTurn();
      for (let progress = 0; progress < 1.0; progress += 0.1) {
        book.updateTurningPage(progress);
        expect(book.getState().getStateIndex()).toBe(stateBefore);
      }

      book.updateTurningPage(1.0);
      expect(book.getState().getStateIndex()).toBe(stateBefore + 1);
    });

    it('can traverse entire book forward', () => {
      const states = [book.getState().getStateIndex()];

      while (book.getState().canTurnForward()) {
        book.startTurn();
        book.updateTurningPage(1.0);
        book.completeTurn();
        states.push(book.getState().getStateIndex());
      }

      // Should see progression: -1, 0, 1, 2, 3, 4
      expect(states).toEqual([-1, 0, 1, 2, 3, 4]);
    });

    it('can traverse entire book backward', () => {
      // Go to end
      while (book.getState().canTurnForward()) {
        book.startTurn();
        book.updateTurningPage(1.0);
        book.completeTurn();
      }

      const states = [book.getState().getStateIndex()];

      while (book.getState().canTurnBackward()) {
        book.startReverseTurn();
        book.updateTurningPage(1.0);
        book.completeTurn();
        states.push(book.getState().getStateIndex());
      }

      // Should see reverse progression: 4, 3, 2, 1, 0, -1
      expect(states).toEqual([4, 3, 2, 1, 0, -1]);
    });
  });

  describe('Curl Axis Updates', () => {
    it('curl axis sweeps from right to left during turn', () => {
      book.startTurn();

      const positions = [];
      for (let progress = 0; progress <= 1.0; progress += 0.2) {
        book.updateTurningPage(progress);

        // We can't directly access the uniform, but we can verify via state
        const phi = book.getState().getRotationAngle();
        const expectedAxis = Math.cos(phi);
        positions.push(expectedAxis);
      }

      // Should go from 1 → 0 → -1
      expect(positions[0]).toBeCloseTo(1, 1);
      expect(positions[2]).toBeCloseTo(0, 1);
      expect(positions[4]).toBeCloseTo(-1, 1);

      // Monotonically decreasing
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeLessThanOrEqual(positions[i - 1] + 0.01);
      }
    });
  });

  describe('Geometry Validation', () => {
    it('turning page group has mesh(es)', () => {
      book.startTurn();
      book.updateTurningPage(0.5);

      const group = book.getGroup();
      const hasMeshes = group.children.some((child) => child instanceof THREE.Mesh);
      expect(hasMeshes).toBe(true);
    });

    it('page geometry remains within bounds', () => {
      book.startTurn();

      for (let progress = 0; progress <= 1.0; progress += 0.2) {
        book.updateTurningPage(progress);

        const group = book.getGroup();
        // Check all mesh bounds
        group.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            const bbox = new THREE.Box3().setFromObject(node);
            
            // Page should stay within [-1, 1] in X
            expect(bbox.min.x).toBeGreaterThanOrEqual(-1.1);
            expect(bbox.max.x).toBeLessThanOrEqual(1.1);

            // Z should stay reasonable (height < 1)
            expect(bbox.max.z).toBeLessThanOrEqual(1.0);
            expect(bbox.min.z).toBeGreaterThanOrEqual(-0.1);
          }
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('handles rapid succession turns gracefully', () => {
      // Try starting turn while already turning - should be prevented
      book.startTurn();
      expect(book.getState().canTurnForward()).toBe(false);

      // Complete the turn
      book.updateTurningPage(1.0);
      book.completeTurn();

      // Should be able to turn again
      expect(book.getState().canTurnForward()).toBe(true);
    });

    it('cannot turn beyond book boundaries', () => {
      // At start
      expect(book.getState().canTurnBackward()).toBe(false);

      // Go to end
      while (book.getState().canTurnForward()) {
        book.startTurn();
        book.updateTurningPage(1.0);
        book.completeTurn();
      }

      // At end
      expect(book.getState().canTurnForward()).toBe(false);
    });
  });

  describe('State Machine Integration', () => {
    it('state machine is never in impossible state j', () => {
      for (let i = 0; i < 10; i++) {
        const j = book.getState().getStateIndex();

        expect(Number.isInteger(j)).toBe(true);
        expect(j).toBeGreaterThanOrEqual(-1);
        expect(j).toBeLessThanOrEqual(4);

        if (book.getState().canTurnForward()) {
          book.startTurn();
          book.updateTurningPage(1.0);
          book.completeTurn();
        }
      }
    });

    it('φ is monotonic during a turn', () => {
      book.startTurn();

      const phis = [];
      for (let progress = 0; progress <= 1.0; progress += 0.05) {
        book.updateTurningPage(progress);
        phis.push(book.getState().getRotationAngle());
      }

      // Should be monotonically increasing
      for (let i = 1; i < phis.length; i++) {
        expect(phis[i]).toBeGreaterThanOrEqual(phis[i - 1] - 1e-5);
      }
    });
  });
});

describe('Book - Physics Verification', () => {
  describe('Must Be Visible to Observer', () => {
    it('page curl is observable (non-zero deformation)', () => {
      const book = new Book({
        numLeaves: 3,
        pageWidth: 1.0,
        curlRadius: 0.15,
      });

      book.startTurn();
      book.updateTurningPage(0.5); // Mid-turn

      // At least one mesh should show deformation
      const group = book.getGroup();
      let foundDeformation = false;

      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const geo = node.geometry as THREE.BufferGeometry;
          if (geo.userData.originalPositions) {
            const positions = geo.getAttribute('position') as THREE.BufferAttribute;
            const original = geo.userData.originalPositions as Float32Array;

            // Check if any vertices have moved
            for (let i = 0; i < positions.count; i++) {
              const origX = original[i * 3];
              const dispX = positions.getX(i);
              const dispZ = positions.getZ(i);

              if (Math.abs(dispX - origX) > 0.01 || Math.abs(dispZ) > 0.01) {
                foundDeformation = true;
              }
            }
          }
        }
      });

      expect(foundDeformation).toBe(true);
    });

    it('curl width varies (tighter at φ=π/2)', () => {
      const measureCurlWidth = (progress: number): number => {
        const book2 = new Book({
          numLeaves: 3,
          pageWidth: 1.0,
          curlRadius: 0.15,
        });

        book2.startTurn();
        book2.updateTurningPage(progress);

        let maxWidth = 0;
        const group = book2.getGroup();

        group.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            const bbox = new THREE.Box3().setFromObject(node);
            // Width is extent from left to right
            maxWidth = Math.max(maxWidth, bbox.max.x - bbox.min.x);
          }
        });

        return maxWidth;
      };

      const w25 = measureCurlWidth(0.25);
      const w50 = measureCurlWidth(0.5);
      const w75 = measureCurlWidth(0.75);

      // Curl should be tightest (smallest width) at middle
      expect(w50).toBeLessThan(w25 + 0.01);
      expect(w50).toBeLessThan(w75 + 0.01);
    });
  });

  describe('Must NOT Be Visible to Observer', () => {
    it('no gravity droop (page edges stay horizontal)', () => {
      const book = new Book({
        numLeaves: 3,
        pageWidth: 1.0,
        curlRadius: 0.15,
      });

      book.startTurn();
      book.updateTurningPage(0.5);

      const group = book.getGroup();
      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const positions = node.geometry.getAttribute('position') as THREE.BufferAttribute;

          // Collect Y positions at the top and bottom of the page
          const topY: number[] = [];
          const bottomY: number[] = [];

          for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i);
            if (y > 0.6) topY.push(y);
            if (y < -0.6) bottomY.push(y);
          }

          // Top edge should be flat (low variance)
          if (topY.length > 0) {
            const topVariance =
              topY.reduce((a, b) => a + (b - topY[0]) ** 2, 0) / topY.length;
            expect(topVariance).toBeLessThan(0.01);
          }

          // Bottom edge should be flat
          if (bottomY.length > 0) {
            const bottomVariance =
              bottomY.reduce((a, b) => a + (b - bottomY[0]) ** 2, 0) / bottomY.length;
            expect(bottomVariance).toBeLessThan(0.01);
          }
        }
      });
    });

    it('turn speed is constant (no easing curves)', () => {
      const book = new Book({
        numLeaves: 3,
        pageWidth: 1.0,
        curlRadius: 0.15,
      });

      book.startTurn();

      const phis = [];
      for (let progress = 0; progress <= 1.0; progress += 0.05) {
        book.updateTurningPage(progress);
        phis.push(book.getState().getRotationAngle());
      }

      // φ should be linear: φ = π·progress
      // So differences should be constant
      const dphis = [];
      for (let i = 1; i < phis.length; i++) {
        dphis.push(phis[i] - phis[i - 1]);
      }

      const mean = dphis.reduce((a, b) => a + b) / dphis.length;
      const variance = dphis.reduce((a, b) => a + (b - mean) ** 2, 0) / dphis.length;

      // Low variance = constant speed
      expect(variance).toBeLessThan(1e-6);
    });
  });
});
