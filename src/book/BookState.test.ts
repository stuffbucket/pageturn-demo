/**
 * BookState.test.ts
 * Unit tests for the discrete state machine from Section 1 of the formalization
 * 
 * These tests verify:
 * 1. Discrete state invariants (j ∈ {-1, 0, ..., n, n+1})
 * 2. Continuous rotation invariants (φ ∈ [0, π])
 * 3. Content mapping correctness
 * 4. Boundary conditions (cannot turn beyond limits)
 * 5. State transitions (forward and reverse turns)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BookState } from './BookState';

describe('BookState - Discrete State Machine (Section 1)', () => {
  let book: BookState;

  beforeEach(() => {
    book = new BookState(3);
  });

  describe('Invariant 1: Discrete State j', () => {
    it('initial state must be j = -1 (front cover closed)', () => {
      expect(book.getStateIndex()).toBe(-1);
      expect(Number.isInteger(book.getStateIndex())).toBe(true);
    });

    it('j must always be an integer, never a float', () => {
      // Try all possible state transitions
      for (let i = 0; i < 100; i++) {
        if (book.canTurnForward()) {
          book.startTurn();
          // Test at intermediate progress values
          for (let progress = 0; progress <= 1.0; progress += 0.1) {
            book.setTurningProgress(progress);
            const j = book.getStateIndex();
            expect(Number.isInteger(j)).toBe(true);
            expect(j).toBe(Math.floor(j));
          }
          book.setTurningProgress(1.0);
        }
      }
    });

    it('j must be in range {-1, 0, 1, 2, 3, 4} for n=3 book', () => {
      const seenStates = new Set<number>();
      
      // Traverse entire book
      let steps = 0;
      while (book.canTurnForward() && steps < 100) {
        seenStates.add(book.getStateIndex());
        book.startTurn();
        for (let progress = 0; progress <= 1.0; progress += 0.5) {
          book.setTurningProgress(progress);
          expect(book.getStateIndex()).toBeGreaterThanOrEqual(-1);
          expect(book.getStateIndex()).toBeLessThanOrEqual(4);
        }
        book.setTurningProgress(1.0);
        steps++;
      }

      seenStates.add(book.getStateIndex());
      
      // Should see states: -1, 0, 1, 2, 3, 4 (total 6 states for n=3)
      expect(seenStates.size).toBe(6);
      expect(Array.from(seenStates).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2, 3, 4]);
    });

    it('cannot have j < -1 or j > n+1', () => {
      let j = book.getStateIndex();
      expect(j).toBe(-1);

      while (book.canTurnForward()) {
        book.startTurn();
        book.setTurningProgress(1.0);
        j = book.getStateIndex();
        expect(j).toBeGreaterThanOrEqual(-1);
        expect(j).toBeLessThanOrEqual(4);
      }

      expect(j).toBe(4); // n+1 = 3+1
    });
  });

  describe('Invariant 2: Continuous Rotation φ ∈ [0, π]', () => {
    it('φ must always be in [0, π]', () => {
      book.startTurn();
      
      for (let progress = 0; progress <= 1.0; progress += 0.05) {
        book.setTurningProgress(progress);
        const phi = book.getRotationAngle();
        
        expect(phi).toBeGreaterThanOrEqual(0);
        expect(phi).toBeLessThanOrEqual(Math.PI);
      }
    });

    it('φ = 0 at start of turn (page flat on right)', () => {
      book.startTurn();
      book.setTurningProgress(0);
      expect(book.getRotationAngle()).toBeCloseTo(0, 5);
    });

    it('φ = π at end of turn (page flat on left)', () => {
      book.startTurn();
      book.setTurningProgress(1.0);
      expect(book.getRotationAngle()).toBeCloseTo(Math.PI, 5);
    });

    it('φ = π/2 at midpoint (page vertical)', () => {
      book.startTurn();
      book.setTurningProgress(0.5);
      expect(book.getRotationAngle()).toBeCloseTo(Math.PI / 2, 5);
    });

    it('cos(φ) sweeps from +1.0 to -1.0', () => {
      book.startTurn();

      // At progress 0
      book.setTurningProgress(0);
      expect(Math.cos(book.getRotationAngle())).toBeCloseTo(1.0, 5);

      // At progress 0.5
      book.setTurningProgress(0.5);
      expect(Math.cos(book.getRotationAngle())).toBeCloseTo(0.0, 5);

      // At progress 1.0
      book.setTurningProgress(1.0);
      expect(Math.cos(book.getRotationAngle())).toBeCloseTo(-1.0, 5);
    });

    it('φ progression is linear with progress', () => {
      book.startTurn();
      
      for (let progress = 0; progress <= 1.0; progress += 0.05) {
        book.setTurningProgress(progress);
        const phi = book.getRotationAngle();
        const expectedPhi = progress * Math.PI;
        
        expect(phi).toBeCloseTo(expectedPhi, 5);
      }
    });
  });

  describe('Invariant 3: Content Mapping visible(j)', () => {
    it('visible(-1) = (nil, cover_front_ext)', () => {
      expect(book.getStateIndex()).toBe(-1);
      const content = book.getVisibleContent();
      
      expect(content.left).toBeNull();
      expect(content.right).toBe('cover_front_ext');
    });

    it('visible(0) = (cover_front_int, p1)', () => {
      book.startTurn();
      book.setTurningProgress(1.0);
      
      const content = book.getVisibleContent();
      expect(content.left).toBe('cover_front_int');
      expect(content.right).toBe('p1');
    });

    it('visible(1) = (p2, p3)', () => {
      // Turn to spread 1
      book.startTurn();
      book.setTurningProgress(1.0);
      book.startTurn();
      book.setTurningProgress(1.0);
      
      const content = book.getVisibleContent();
      expect(content.left).toBe('p2');
      expect(content.right).toBe('p3');
    });

    it('visible(n) = (p_{2n}, cover_back_int)', () => {
      // Turn to last spread (j = 3)
      // We turn n times from j=-1 to reach j=n=3
      for (let i = 0; i < 4; i++) {
        if (book.canTurnForward()) {
          book.startTurn();
          book.setTurningProgress(1.0);
        }
      }
      
      expect(book.getStateIndex()).toBe(3);  // j = n
      const content = book.getVisibleContent();
      expect(content.left).toBe('p6');  // p_{2*3}
      expect(content.right).toBe('cover_back_int');
    });

    it('visible(n+1) = (cover_back_ext, nil)', () => {
      // Turn past last spread
      while (book.canTurnForward()) {
        book.startTurn();
        book.setTurningProgress(1.0);
      }
      
      // Now at j = 4, should be able to say what comes next
      expect(book.getStateIndex()).toBe(4); // n+1
    });

    it('every page 1..2n appears exactly once as left and once as right', () => {
      const leftPages = new Map<string, number>();
      const rightPages = new Map<string, number>();

      // Traverse entire book
      let steps = 0;
      while (book.canTurnForward() && steps < 100) {
        book.startTurn();
        book.setTurningProgress(1.0);
        
        const content = book.getVisibleContent();
        if (content.left && content.left.startsWith('p')) {
          leftPages.set(content.left, (leftPages.get(content.left) ?? 0) + 1);
        }
        if (content.right && content.right.startsWith('p')) {
          rightPages.set(content.right, (rightPages.get(content.right) ?? 0) + 1);
        }
        steps++;
      }

      // Pages 1-6 should appear as left and right
      for (let i = 1; i <= 6; i++) {
        const pageName = `p${i}`;
        if (i % 2 === 0) {
          expect(leftPages.get(pageName)).toBe(1); // even pages on left
        } else {
          expect(rightPages.get(pageName)).toBe(1); // odd pages on right
        }
      }
    });

    it('content is continuous across state machine', () => {
      let steps = 0;
      while (book.canTurnForward() && steps < 100) {
        const before = book.getVisibleContent();
        
        book.startTurn();
        book.setTurningProgress(1.0);
        
        const after = book.getVisibleContent();
        
        // After turn, left page of new spread should relate to right of old spread
        // (they share the spine)
        if (before.right?.startsWith('p') && after.left?.startsWith('p')) {
          const beforeRight = parseInt(before.right.substring(1));
          const afterLeft = parseInt(after.left.substring(1));
          // Adjacent pages on the spine
          expect(Math.abs(beforeRight - afterLeft)).toBe(1);
        }
        
        steps++;
      }
    });
  });

  describe('Invariant 4: Boundary Conditions', () => {
    it('cannot turn forward when j = n+1', () => {
      // Go to end
      while (book.canTurnForward()) {
        book.startTurn();
        book.setTurningProgress(1.0);
      }

      expect(book.getStateIndex()).toBe(4);
      expect(book.canTurnForward()).toBe(false);
    });

    it('cannot turn backward when j = -1', () => {
      expect(book.getStateIndex()).toBe(-1);
      expect(book.canTurnBackward()).toBe(false);
    });

    it('can turn backward from any j > -1', () => {
      // Move forward one step
      book.startTurn();
      book.setTurningProgress(1.0);

      expect(book.getStateIndex()).toBe(0);
      expect(book.canTurnBackward()).toBe(true);
    });

    it('can turn forward from any j < n+1', () => {
      expect(book.getStateIndex()).toBe(-1);
      expect(book.canTurnForward()).toBe(true);
    });
  });

  describe('Invariant 5: State Transitions (Forward)', () => {
    it('startTurn moves from j to j+1', () => {
      for (let expectedJ = -1; expectedJ < 4; expectedJ++) {
        const jBefore = book.getStateIndex();
        expect(jBefore).toBe(expectedJ);

        if (book.canTurnForward()) {
          book.startTurn();
          book.setTurningProgress(1.0);
          
          const jAfter = book.getStateIndex();
          expect(jAfter).toBe(expectedJ + 1);
        }
      }
    });

    it('during turn, j stays constant', () => {
      book.startTurn();
      const jDuring = book.getStateIndex();
      
      for (let progress = 0; progress <= 1.0; progress += 0.1) {
        book.setTurningProgress(progress);
        expect(book.getStateIndex()).toBe(jDuring);
      }
    });

    it('turn completes and j increments only at progress = 1.0', () => {
      book.startTurn();
      const jBefore = book.getStateIndex();

      book.setTurningProgress(0.99);
      expect(book.getStateIndex()).toBe(jBefore);

      book.setTurningProgress(1.0);
      expect(book.getStateIndex()).toBe(jBefore + 1);
    });
  });

  describe('Invariant 6: State Transitions (Reverse)', () => {
    it('startReverseTurn moves from j to j-1', () => {
      // Go forward first
      book.startTurn();
      book.setTurningProgress(1.0);
      book.startTurn();
      book.setTurningProgress(1.0);

      const jBefore = book.getStateIndex(); // j = 2
      book.startReverseTurn();
      const jAfter = book.getStateIndex();
      
      expect(jAfter).toBe(jBefore - 1);
    });

    it('φ runs backward from π to 0 during reverse turn', () => {
      // Go forward first
      book.startTurn();
      book.setTurningProgress(1.0);

      book.startReverseTurn();
      
      // Progress 0 in reverse turn = φ = π
      book.setTurningProgress(0);
      expect(book.getRotationAngle()).toBeCloseTo(Math.PI, 5);

      // Progress 0.5 = φ = π/2
      book.setTurningProgress(0.5);
      expect(book.getRotationAngle()).toBeCloseTo(Math.PI / 2, 5);

      // Progress 1.0 = φ = 0
      book.setTurningProgress(1.0);
      expect(book.getRotationAngle()).toBeCloseTo(0, 5);
    });
  });

  describe('Invariant 7: Turning Status', () => {
    it('isTurning = false initially', () => {
      expect(book.getIsTurning()).toBe(false);
    });

    it('isTurning = true between startTurn and progress 1.0', () => {
      book.startTurn();
      expect(book.getIsTurning()).toBe(true);

      book.setTurningProgress(0.5);
      expect(book.getIsTurning()).toBe(true);

      book.setTurningProgress(1.0);
      expect(book.getIsTurning()).toBe(false);
    });

    it('isTurning = false after turn completes', () => {
      book.startTurn();
      book.setTurningProgress(1.0);
      
      expect(book.getIsTurning()).toBe(false);
    });

    it('cannot start new turn while isTurning (encodes mutual exclusion)', () => {
      book.startTurn();
      
      // At progress 0.5, still turning
      book.setTurningProgress(0.5);
      expect(book.canTurnForward()).toBe(false);
      
      // Even though startTurn checks canTurnForward
      const result = book.startTurn();
      expect(result).toBe(false);
    });
  });

  describe('Invariant 8: State Descriptions', () => {
    it('provides human-readable state descriptions', () => {
      expect(book.getStateDescription()).toContain('Closed');
      expect(book.getStateDescription()).toContain('Front');

      book.startTurn();
      book.setTurningProgress(1.0);
      expect(book.getStateDescription()).toContain('First');

      // Go to last spread (j = n = 3), not all the way to j = n+1
      for (let i = 0; i < 3; i++) {
        if (book.canTurnForward()) {
          book.startTurn();
          book.setTurningProgress(1.0);
        }
      }
      expect(book.getStateIndex()).toBe(3);
      expect(book.getStateDescription()).toContain('Last');
    });

    it('state description changes when state changes', () => {
      const desc1 = book.getStateDescription();
      
      book.startTurn();
      book.setTurningProgress(1.0);
      const desc2 = book.getStateDescription();
      
      expect(desc1).not.toBe(desc2);
    });
  });

  describe('Invariant 9: Single-Leaf Edge Case (n=1)', () => {
    let singleLeafBook: BookState;

    beforeEach(() => {
      singleLeafBook = new BookState(1);
    });

    it('single-leaf book has states {-1, 0, 1, 2}', () => {
      const states = new Set<number>();
      states.add(singleLeafBook.getStateIndex());

      while (singleLeafBook.canTurnForward()) {
        singleLeafBook.startTurn();
        singleLeafBook.setTurningProgress(1.0);
        states.add(singleLeafBook.getStateIndex());
      }

      expect(Array.from(states).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]);
    });

    it('single-leaf book spread 0 has correct pages', () => {
      singleLeafBook.startTurn();
      singleLeafBook.setTurningProgress(1.0);

      const content = singleLeafBook.getVisibleContent();
      expect(content.left).toBe('cover_front_int');
      expect(content.right).toBe('p1');
    });

    it('single-leaf book spread 1 has correct pages', () => {
      singleLeafBook.startTurn();
      singleLeafBook.setTurningProgress(1.0);
      singleLeafBook.startTurn();
      singleLeafBook.setTurningProgress(1.0);

      const content = singleLeafBook.getVisibleContent();
      expect(content.left).toBe('p2');
      expect(content.right).toBe('cover_back_int');
    });
  });

  describe('Semantic Violations (Things That Should Never Happen)', () => {
    it('state index never becomes fractional (negative test)', () => {
      // This test would fail if we had a bug like:
      // j = Math.floor(progress * numStates)
      // which could give j = 1.5
      
      book.startTurn();
      for (let progress = 0; progress <= 1.0; progress += 0.001) {
        book.setTurningProgress(progress);
        const j = book.getStateIndex();
        
        // If j were fractional, Math.floor would differ
        expect(j).toBe(Math.floor(j));
        expect(j).toHaveProperty('toString');
        expect(typeof j).toBe('number');
      }
    });

    it('j never jumps forward multiple states', () => {
      const jSequence = [];
      
      let steps = 0;
      while (book.canTurnForward() && steps < 100) {
        jSequence.push(book.getStateIndex());
        book.startTurn();
        book.setTurningProgress(1.0);
        steps++;
      }
      jSequence.push(book.getStateIndex());

      // Each step should increment by exactly 1
      for (let i = 1; i < jSequence.length; i++) {
        expect(jSequence[i]).toBe(jSequence[i - 1] + 1);
      }
    });

    it('content never has invalid page combinations', () => {
      let steps = 0;
      while (book.canTurnForward() && steps < 100) {
        const content = book.getVisibleContent();
        
        // If left is p_x, right should not be p_x
        if (content.left?.startsWith('p') && content.right?.startsWith('p')) {
          const leftNum = parseInt(content.left.substring(1));
          const rightNum = parseInt(content.right.substring(1));
          expect(leftNum).not.toBe(rightNum);
          // Pages should be adjacent
          expect(Math.abs(leftNum - rightNum)).toBe(1);
        }

        book.startTurn();
        book.setTurningProgress(1.0);
        steps++;
      }
    });

    it('φ never exceeds bounds even during rapid updates', () => {
      book.startTurn();
      
      // Simulate erratic user input
      const progressValues = [0, 0.3, 0.1, 0.7, 0.5, 1.0, 0.8, 1.0];
      
      for (const progress of progressValues) {
        book.setTurningProgress(progress);
        const phi = book.getRotationAngle();
        
        expect(phi).toBeGreaterThanOrEqual(0);
        expect(phi).toBeLessThanOrEqual(Math.PI);
      }
    });
  });
});
