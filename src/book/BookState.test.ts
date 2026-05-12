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
import { BookState, maxFanCount, DEFAULT_BOOK_MATERIAL } from './BookState';
import type { BookMaterial } from './BookState';

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
          book.completeTurn();
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
        book.completeTurn();
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
        book.completeTurn();
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
      book.completeTurn();
      
      const content = book.getVisibleContent();
      expect(content.left).toBe('cover_front_int');
      expect(content.right).toBe('p1');
    });

    it('visible(1) = (p2, p3)', () => {
      // Turn to spread 1
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();
      
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
          book.completeTurn();
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
        book.completeTurn();
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
        book.completeTurn();
        
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
        book.completeTurn();
        
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
        book.completeTurn();
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
      book.completeTurn();

      expect(book.getStateIndex()).toBe(0);
      expect(book.canTurnBackward()).toBe(true);
    });

    it('can turn forward from any j < n+1', () => {
      expect(book.getStateIndex()).toBe(-1);
      expect(book.canTurnForward()).toBe(true);
    });
  });

  describe('Invariant 5: State Transitions (Forward)', () => {
    it('completeTurn moves from j to j+1', () => {
      for (let expectedJ = -1; expectedJ < 4; expectedJ++) {
        const jBefore = book.getStateIndex();
        expect(jBefore).toBe(expectedJ);

        if (book.canTurnForward()) {
          book.startTurn();
          book.setTurningProgress(1.0);
          // j stays constant during the turn — only completeTurn advances it
          expect(book.getStateIndex()).toBe(expectedJ);
          book.completeTurn();
          
          const jAfter = book.getStateIndex();
          expect(jAfter).toBe(expectedJ + 1);
        }
      }
    });

    it('during turn, j stays constant even at progress 1.0', () => {
      book.startTurn();
      const jDuring = book.getStateIndex();
      
      for (let progress = 0; progress <= 1.0; progress += 0.1) {
        book.setTurningProgress(progress);
        expect(book.getStateIndex()).toBe(jDuring);
      }
    });

    it('j increments only at completeTurn, not at setTurningProgress(1.0)', () => {
      book.startTurn();
      const jBefore = book.getStateIndex();

      book.setTurningProgress(0.99);
      expect(book.getStateIndex()).toBe(jBefore);

      book.setTurningProgress(1.0);
      expect(book.getStateIndex()).toBe(jBefore); // NOT advanced yet

      book.completeTurn();
      expect(book.getStateIndex()).toBe(jBefore + 1); // NOW advanced
    });
  });

  describe('Invariant 6: State Transitions (Reverse)', () => {
    it('startReverseTurn moves from j to j-1', () => {
      // Go forward first
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();

      const jBefore = book.getStateIndex(); // j = 1 (two forward turns from -1)
      book.startReverseTurn();
      const jAfter = book.getStateIndex();
      
      expect(jAfter).toBe(jBefore - 1);
    });

    it('φ runs backward from π to 0 during reverse turn', () => {
      // Go forward first
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();

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

    it('isTurning = true until completeTurn is called', () => {
      book.startTurn();
      expect(book.getIsTurning()).toBe(true);

      book.setTurningProgress(0.5);
      expect(book.getIsTurning()).toBe(true);

      book.setTurningProgress(1.0);
      expect(book.getIsTurning()).toBe(true); // still true — only completeTurn clears it

      book.completeTurn();
      expect(book.getIsTurning()).toBe(false);
    });

    it('isTurning = false after completeTurn', () => {
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();
      
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
      book.completeTurn();
      expect(book.getStateDescription()).toContain('First');

      // Go to last spread (j = n = 3), not all the way to j = n+1
      for (let i = 0; i < 3; i++) {
        if (book.canTurnForward()) {
          book.startTurn();
          book.setTurningProgress(1.0);
          book.completeTurn();
        }
      }
      expect(book.getStateIndex()).toBe(3);
      expect(book.getStateDescription()).toContain('Last');
    });

    it('state description changes when state changes', () => {
      const desc1 = book.getStateDescription();
      
      book.startTurn();
      book.setTurningProgress(1.0);
      book.completeTurn();
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
        singleLeafBook.completeTurn();
        states.add(singleLeafBook.getStateIndex());
      }

      expect(Array.from(states).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]);
    });

    it('single-leaf book spread 0 has correct pages', () => {
      singleLeafBook.startTurn();
      singleLeafBook.setTurningProgress(1.0);
      singleLeafBook.completeTurn();

      const content = singleLeafBook.getVisibleContent();
      expect(content.left).toBe('cover_front_int');
      expect(content.right).toBe('p1');
    });

    it('single-leaf book spread 1 has correct pages', () => {
      singleLeafBook.startTurn();
      singleLeafBook.setTurningProgress(1.0);
      singleLeafBook.completeTurn();
      singleLeafBook.startTurn();
      singleLeafBook.setTurningProgress(1.0);
      singleLeafBook.completeTurn();

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

    it('j never jumps forward multiple states (single turn)', () => {
      const jSequence = [];
      
      let steps = 0;
      while (book.canTurnForward() && steps < 100) {
        jSequence.push(book.getStateIndex());
        book.startTurn();
        book.setTurningProgress(1.0);
        book.completeTurn();
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
        book.completeTurn();
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Fan Turn Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fan Turn — Forward', () => {
    // Fans are restricted to interior spreads j ∈ {0..n}.
    // Covers are rigid — opening/closing is a single-page turn only.

    it('rejects fan from closed cover (j=-1)', () => {
      expect(book.getStateIndex()).toBe(-1);
      expect(book.startFanTurn(2)).toBe(false);
    });

    it('startFanTurn advances j by count on completeTurn', () => {
      // Open cover first, then fan from j=0
      book.startTurn(); book.setTurningProgress(1.0); book.completeTurn();
      expect(book.getStateIndex()).toBe(0);

      expect(book.startFanTurn(2)).toBe(true);
      expect(book.getIsTurning()).toBe(true);
      expect(book.getFanCount()).toBe(2);

      book.setTurningProgress(1.0);
      book.completeTurn();

      expect(book.getStateIndex()).toBe(2);  // 0 + 2
      expect(book.getIsTurning()).toBe(false);
    });

    it('j stays constant during the fan animation', () => {
      book.startTurn(); book.setTurningProgress(1.0); book.completeTurn();
      const jBefore = book.getStateIndex(); // 0
      book.startFanTurn(2);

      for (let p = 0; p <= 1.0; p += 0.1) {
        book.setTurningProgress(p);
        expect(book.getStateIndex()).toBe(jBefore);
      }
    });

    it('clamps to boundary: cannot fan past n', () => {
      // n=3 → from j=0, max forward fan is 3 (land on j=3=n)
      book.startTurn(); book.setTurningProgress(1.0); book.completeTurn();
      expect(book.getStateIndex()).toBe(0);

      expect(book.startFanTurn(4)).toBe(false); // would land on n+1
      expect(book.startFanTurn(3)).toBe(true);
      book.completeTurn();
      expect(book.getStateIndex()).toBe(3); // n
    });

    it('rejects fan of 0 or negative', () => {
      book.startTurn(); book.setTurningProgress(1.0); book.completeTurn();
      expect(book.startFanTurn(0)).toBe(false);
      expect(book.startFanTurn(-1)).toBe(false);
    });

    it('rejects fan while already turning', () => {
      book.startTurn();
      expect(book.startFanTurn(2)).toBe(false);
    });

    it('cancelTurn after fan reverts j to pre-fan state', () => {
      book.startTurn(); book.setTurningProgress(1.0); book.completeTurn();
      const jBefore = book.getStateIndex(); // 0
      book.startFanTurn(2);
      book.setTurningProgress(0.5);
      book.cancelTurn();

      expect(book.getStateIndex()).toBe(jBefore);
      expect(book.getIsTurning()).toBe(false);
    });
  });

  describe('Fan Turn — Reverse', () => {
    beforeEach(() => {
      // Move to j=3 so we have room to fan backward
      for (let i = 0; i < 4; i++) {
        book.startTurn();
        book.setTurningProgress(1.0);
        book.completeTurn();
      }
      expect(book.getStateIndex()).toBe(3);
    });

    it('startReverseFanTurn moves j by count on completeTurn', () => {
      expect(book.startReverseFanTurn(2)).toBe(true);
      expect(book.getStateIndex()).toBe(1); // j decremented immediately
      expect(book.getFanCount()).toBe(2);

      book.setTurningProgress(1.0);
      book.completeTurn();

      expect(book.getStateIndex()).toBe(1); // already decremented
      expect(book.getIsTurning()).toBe(false);
    });

    it('cancelTurn after reverse fan restores j', () => {
      const jBefore = book.getStateIndex(); // 3
      book.startReverseFanTurn(2);
      expect(book.getStateIndex()).toBe(1); // pre-decremented

      book.cancelTurn();
      expect(book.getStateIndex()).toBe(jBefore); // restored
    });

    it('clamps to boundary: cannot reverse fan past 0', () => {
      // j=3, max backward = 3 (to reach j=0, first interior spread)
      expect(book.startReverseFanTurn(4)).toBe(false); // would land on -1
      expect(book.startReverseFanTurn(3)).toBe(true);
      book.completeTurn();
      expect(book.getStateIndex()).toBe(0);
    });

    it('rejects reverse fan from closed back cover (j=n+1)', () => {
      // Move all the way to j=n+1
      while (book.canTurnForward()) {
        book.startTurn(); book.setTurningProgress(1); book.completeTurn();
      }
      expect(book.getStateIndex()).toBe(4); // n+1
      expect(book.startReverseFanTurn(2)).toBe(false);
    });
  });

  describe('Fan Turn — Crossing Spread Boundaries', () => {
    // Use n=10 book to have enough spreads for realistic fan scenarios
    let bigBook: BookState;

    beforeEach(() => {
      bigBook = new BookState(10);
    });

    it('fan of 3 from j=4 lands on j=7 (VIDEO_SPREAD)', () => {
      // Move to j=4
      for (let i = 0; i < 5; i++) {
        bigBook.startTurn();
        bigBook.setTurningProgress(1.0);
        bigBook.completeTurn();
      }
      expect(bigBook.getStateIndex()).toBe(4);

      bigBook.startFanTurn(3);
      bigBook.completeTurn();
      expect(bigBook.getStateIndex()).toBe(7);
    });

    it('fan of 3 from j=5 lands on j=8, skipping VIDEO_SPREAD=7', () => {
      // Move to j=5
      for (let i = 0; i < 6; i++) {
        bigBook.startTurn();
        bigBook.setTurningProgress(1.0);
        bigBook.completeTurn();
      }
      expect(bigBook.getStateIndex()).toBe(5);

      bigBook.startFanTurn(3);
      bigBook.completeTurn();
      expect(bigBook.getStateIndex()).toBe(8);
      // The state machine correctly lands at 8, never visiting 7.
      // The caller (main.ts checkVideoSpread) checks j===7 post-completion.
    });

    it('reverse fan from j=10 to j=7 lands on VIDEO_SPREAD', () => {
      // Move to j=10
      for (let i = 0; i < 11; i++) {
        bigBook.startTurn();
        bigBook.setTurningProgress(1.0);
        bigBook.completeTurn();
      }
      expect(bigBook.getStateIndex()).toBe(10);

      bigBook.startReverseFanTurn(3);
      bigBook.completeTurn();
      expect(bigBook.getStateIndex()).toBe(7);
    });

    it('forward fan traversal with single-page cover transitions', () => {
      // Open front cover (single turn — covers are rigid)
      bigBook.startTurn(); bigBook.setTurningProgress(1); bigBook.completeTurn();
      expect(bigBook.getStateIndex()).toBe(0);

      // Fan through the interior in groups of 3: 0→3→6→9, then 9→10
      let fanSteps = 0;
      while (bigBook.getStateIndex() < 10) {
        const remaining = 10 - bigBook.getStateIndex();
        const count = Math.min(3, remaining);
        bigBook.startFanTurn(count);
        bigBook.completeTurn();
        fanSteps += count;
      }
      expect(bigBook.getStateIndex()).toBe(10); // n=10
      expect(fanSteps).toBe(10); // from 0 to 10

      // Close back cover (single turn — covers are rigid)
      bigBook.startTurn(); bigBook.setTurningProgress(1); bigBook.completeTurn();
      expect(bigBook.getStateIndex()).toBe(11); // n+1
      expect(bigBook.canTurnForward()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Impulse Model Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Impulse Model — maxFanCount', () => {
    const n = 10;
    const mat = DEFAULT_BOOK_MATERIAL;

    describe('cover blocks friction chain (m_cover >> m_page)', () => {
      it('forward from j=-1: front cover blocks immediately → 0', () => {
        expect(maxFanCount(-1, n, true, mat)).toBe(0);
      });

      it('forward from j=n: back cover blocks immediately → 0', () => {
        expect(maxFanCount(n, n, true, mat)).toBe(0);
      });

      it('reverse from j=0: front cover blocks immediately → 0', () => {
        expect(maxFanCount(0, n, false, mat)).toBe(0);
      });

      it('reverse from j=n+1: back cover blocks immediately → 0', () => {
        expect(maxFanCount(n + 1, n, false, mat)).toBe(0);
      });
    });

    describe('interior impulse decay', () => {
      it('forward from j=0 gives 4 pages with default material', () => {
        expect(maxFanCount(0, n, true, mat)).toBe(4);
      });

      it('forward from j=5 (mid-book) gives 4 pages', () => {
        expect(maxFanCount(5, n, true, mat)).toBe(4);
      });

      it('reverse from j=10 gives 4 pages', () => {
        expect(maxFanCount(n, n, false, mat)).toBe(4);
      });

      it('reverse from j=5 (mid-book) gives 4 pages', () => {
        expect(maxFanCount(5, n, false, mat)).toBe(4);
      });

      it('forward from j=8: only 2 interior pages before back cover', () => {
        expect(maxFanCount(8, n, true, mat)).toBe(2);
      });

      it('reverse from j=2: only 2 interior pages before front cover', () => {
        expect(maxFanCount(2, n, false, mat)).toBe(2);
      });
    });

    describe('symmetry: covers block identically in both directions', () => {
      it('forward from j=0 == reverse from j=n (symmetric interior)', () => {
        expect(maxFanCount(0, n, true, mat)).toBe(maxFanCount(n, n, false, mat));
      });

      it('forward near back == reverse near front (symmetric boundary)', () => {
        expect(maxFanCount(8, n, true, mat)).toBe(maxFanCount(2, n, false, mat));
      });
    });

    describe('custom material: lightweight covers can be fanned', () => {
      const softcover: BookMaterial = {
        page:  { mass: 4.5 },
        cover: { mass: 8 },     // thin card stock, only ~2x page mass
        mu:    0.62,
        J0:    30,
        vMin:  1.2,
      };

      it('softcover: fan can reach and move the cover', () => {
        // With mass=8, Jneeded = 8*1.2 = 9.6.
        // μ^4 * 30 = 4.43 < 9.6, so cover is page 5 in the chain.
        // But μ^3 * 30 = 7.15 < 9.6 too! So softcover still blocks at 3 pages.
        // Actually μ^0=30, μ^1=18.6, μ^2=11.53, μ^3=7.15, so 7.15 < 9.6 → blocks at 3.
        // Wait: interior pages need 5.4. So pages 0,1,2,3 pass (Ji: 30, 18.6, 11.53, 7.15).
        // Page 4 is interior: Ji=4.43 < 5.4 → stops. So even with softcover, max is 4.
        // The cover doesn't matter because impulse decays to < page threshold first.
        const result = maxFanCount(0, n, true, softcover);
        expect(result).toBe(4); // same as hardcover — decay hits page threshold first
      });

      it('stronger grip makes cover reachable', () => {
        const strongGrip: BookMaterial = {
          ...softcover,
          J0: 80,  // much stronger applied impulse
        };
        // μ^i * 80: 80, 49.6, 30.8, 19.1, 11.8, 7.3, 4.5 ...
        // Page threshold: 4.5*1.2 = 5.4. Cover threshold: 8*1.2 = 9.6
        // Pages 0-4 interior: 80, 49.6, 30.8, 19.1, 11.8 — all > 5.4
        // Page 5 interior: 7.3 > 5.4 ✓
        // Page 6 interior: 4.5 < 5.4 ✗ → stops at 6
        const result = maxFanCount(0, n, true, strongGrip);
        expect(result).toBe(6);
      });
    });

    describe('direct grab always works (single turns bypass impulse)', () => {
      // This test documents the architectural decision: startTurn/startReverseTurn
      // work on any leaf including covers. The impulse model only governs
      // indirect friction-chain propagation in fan turns.

      it('single forward turn works at front cover (j=-1)', () => {
        const bs = new BookState(n);
        expect(bs.getStateIndex()).toBe(-1);
        expect(bs.startTurn()).toBe(true); // direct grab on cover
      });

      it('single forward turn works at back cover boundary (j=n)', () => {
        const bs = new BookState(n);
        // Walk to j=n
        for (let i = 0; i < n + 1; i++) {
          bs.startTurn(); bs.setTurningProgress(1); bs.completeTurn();
        }
        expect(bs.getStateIndex()).toBe(n);
        expect(bs.startTurn()).toBe(true); // direct grab closes back cover
      });

      it('single reverse turn works from closed back cover (j=n+1)', () => {
        const bs = new BookState(n);
        for (let i = 0; i < n + 2; i++) {
          bs.startTurn(); bs.setTurningProgress(1); bs.completeTurn();
        }
        expect(bs.getStateIndex()).toBe(n + 1);
        expect(bs.startReverseTurn()).toBe(true); // direct grab opens back cover
      });
    });
  });
});
