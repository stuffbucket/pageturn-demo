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
      // getTotalStates() returns numLeaves + 2, used as (maxJ + 1) in UI.
      // For n=3: states {-1,0,1,2,3,4}, maxJ=4, so numLeaves+2 = 5.
      expect(state.getTotalStates()).toBe(5);
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
      book.completeTurn();

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
    it('state index advances only after completeTurn', () => {
      const stateBefore = book.getState().getStateIndex();

      book.startTurn();
      for (let progress = 0; progress <= 1.0; progress += 0.1) {
        book.updateTurningPage(progress);
        expect(book.getState().getStateIndex()).toBe(stateBefore);
      }

      // j stays constant until completeTurn — the sole transition point
      book.completeTurn();
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
      for (let progress = 0; progress <= 1.0; progress += 0.25) {
        book.updateTurningPage(progress);

        const phi = book.getState().getRotationAngle();
        const expectedAxis = Math.cos(phi);
        positions.push(expectedAxis);
      }

      // progress 0/0.25/0.5/0.75/1.0 → cos(0) / cos(π/4) / cos(π/2) / cos(3π/4) / cos(π)
      expect(positions[0]).toBeCloseTo(1, 1);
      expect(positions[2]).toBeCloseTo(0, 1);  // progress=0.5 → cos(π/2)=0
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

  describe('Turning page front/back texture binding (regression)', () => {
    // Regression for the 2026-05-15 bug where the back face of the turning
    // page rendered the (mirrored) front texture instead of the back
    // texture. Root cause: Three.js implements `side: BackSide` by calling
    // `gl.frontFace(gl.CW)`, which makes gl_FrontFacing evaluate to TRUE
    // inside the back-mesh draw. The original FLIP_FRAG branched on
    // gl_FrontFacing, so the back mesh sampled frontTexture too. Fix
    // switches to a static IS_BACK shader define on the back material.
    function getTurningMeshes(): { front: THREE.Mesh; back: THREE.Mesh } {
      const group = book.getGroup();
      let front: THREE.Mesh | null = null;
      group.traverse((node) => {
        if (
          !front &&
          node instanceof THREE.Mesh &&
          (node.material as THREE.ShaderMaterial).isShaderMaterial &&
          ((node.material as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform>)
            .frontTexture !== undefined
        ) {
          front = node;
        }
      });
      if (!front) throw new Error('turning front mesh not found');
      const f = front as THREE.Mesh;
      const back = f.children.find(
        (c) => c instanceof THREE.Mesh,
      ) as THREE.Mesh | undefined;
      if (!back) throw new Error('turning back mesh not found');
      return { front: f, back };
    }

    it('front mesh uses FrontSide and binds frontTexture, back mesh uses BackSide with IS_BACK define and binds backTexture', () => {
      book.startTurn();
      book.updateTurningPage(0.3);

      const { front, back } = getTurningMeshes();
      const fMat = front.material as THREE.ShaderMaterial;
      const bMat = back.material as THREE.ShaderMaterial;

      expect(fMat.side).toBe(THREE.FrontSide);
      expect(bMat.side).toBe(THREE.BackSide);

      // The IS_BACK define is what guarantees the back mesh samples
      // backTexture independent of gl_FrontFacing's BackSide-flip behavior.
      expect(fMat.defines?.IS_BACK).toBeUndefined();
      expect(bMat.defines?.IS_BACK).toBeDefined();

      // Both materials share uniforms, but assert both textures are bound
      // and distinct (different content per face).
      const fTex = fMat.uniforms.frontTexture.value as THREE.Texture | null;
      const bTex = fMat.uniforms.backTexture.value as THREE.Texture | null;
      expect(fTex).not.toBeNull();
      expect(bTex).not.toBeNull();
      expect(fTex).not.toBe(bTex);

      // Back material sees the same uniforms object.
      expect(bMat.uniforms.frontTexture.value).toBe(fTex);
      expect(bMat.uniforms.backTexture.value).toBe(bTex);
    });

    it('FLIP_FRAG sources the back texture only via the IS_BACK define, never via gl_FrontFacing', () => {
      book.startTurn();
      book.updateTurningPage(0.3);
      const { front, back } = getTurningMeshes();
      const fMat = front.material as THREE.ShaderMaterial;
      const bMat = back.material as THREE.ShaderMaterial;
      // Both materials share the same fragment shader source. Guard against
      // a regression that re-introduces the gl_FrontFacing branch.
      expect(fMat.fragmentShader).toBe(bMat.fragmentShader);
      expect(fMat.fragmentShader).not.toMatch(/gl_FrontFacing/);
      expect(fMat.fragmentShader).toMatch(/#ifdef\s+IS_BACK/);
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

      // The current tilted-crease model does deformation on the GPU via a
      // vertex shader.  Verify the turning page exists and has uDihedral set
      // to a non-zero value (mid-turn = π/2).
      const group = book.getGroup();
      let foundShaderAngle = false;

      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const mat = node.material;
          if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uDihedral) {
            const dihedral = mat.uniforms.uDihedral.value as number;
            if (Math.abs(dihedral) > 0.1) {
              foundShaderAngle = true;
            }
          }
        }
      });

      expect(foundShaderAngle).toBe(true);
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

// ── Helpers for advanced tests ────────────────────────────────────────────────

/** Navigate a book to spread j by doing j+1 forward turns from the initial j=-1. */
function goToSpread(book: Book, target: number): void {
  while (book.getState().getStateIndex() < target) {
    book.startTurn();
    book.updateTurningPage(1.0);
    book.completeTurn();
  }
}

/** Count how many fan page meshes (ShaderMaterial with uDihedral) are in the group. */
function countFanPages(book: Book): number {
  let count = 0;
  book.getGroup().traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const mat = node.material;
      if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uDihedral) {
        count++;
      }
    }
  });
  return count;
}

// ── Cancel Fan Turn ──────────────────────────────────────────────────────────

describe('Book - Cancel Fan Turn', () => {
  it('cancelFanTurn restores state index', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 3);
    expect(book.getState().getStateIndex()).toBe(3);

    book.startFanTurn(2, false);
    expect(book.getState().getIsTurning()).toBe(true);
    book.updateFanTurn(0.5);

    book.cancelFanTurn();
    expect(book.getState().getIsTurning()).toBe(false);
    expect(book.getState().getStateIndex()).toBe(3);
  });

  it('cancelFanTurn removes all fan page meshes', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 3);

    book.startFanTurn(3, false);
    // fan pages are ShaderMaterial meshes beyond the 2 spread + crease
    const before = countFanPages(book);
    expect(before).toBeGreaterThanOrEqual(3);

    book.cancelFanTurn();
    // After cancel, only the crease ShaderMaterial remains (uOpacity, no uAngle)
    expect(countFanPages(book)).toBe(0);
  });

  it('cancelFanTurn restores state for reverse fan', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 6);

    book.startFanTurn(3, true);
    book.updateFanTurn(0.4);

    book.cancelFanTurn();
    expect(book.getState().getStateIndex()).toBe(6);
    expect(book.getState().getIsTurning()).toBe(false);
  });

  it('cancelTurn during single page turn restores state', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 4);

    book.startTurn();
    book.updateTurningPage(0.3);

    book.cancelTurn();
    expect(book.getState().getStateIndex()).toBe(4);
    expect(book.getState().getIsTurning()).toBe(false);
  });
});

// ── Fan × Popup Integration ─────────────────────────────────────────────────

// Skipped because the popup feature is currently disabled — `// this.createPopup()`
// in Book.ts:191 is commented out. These tests encode the popup contract for when
// the feature ships. Re-enable when the disabled call site is restored. Tracks issue #20.
describe.skip('Book - Fan × Popup', () => {
  const POPUP_SPREAD = 7;

  it('popup is hidden initially (book starts at j=-1)', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    expect(book.isPopupVisible()).toBe(false);
  });

  it('popup unfolds when landing on popup spread via single turn', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, POPUP_SPREAD);
    expect(book.isPopupVisible()).toBe(true);
    expect(book.getPopupFoldProgress()).toBe(1);
  });

  it('popup folds closed when leaving popup spread', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, POPUP_SPREAD);
    expect(book.isPopupVisible()).toBe(true);

    // Turn away
    book.startTurn();
    book.updateTurningPage(1.0);
    book.completeTurn();
    expect(book.getState().getStateIndex()).toBe(POPUP_SPREAD + 1);
    expect(book.isPopupVisible()).toBe(false);
  });

  it('popup arriving fold progress tracks turn progress', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, POPUP_SPREAD - 1);

    book.startTurn();
    book.updateTurningPage(0.5);
    // Arriving: fold progress should match turn progress
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.5, 1);

    book.updateTurningPage(0.8);
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.8, 1);

    book.updateTurningPage(1.0);
    book.completeTurn();
    expect(book.getPopupFoldProgress()).toBe(1);
    expect(book.isPopupVisible()).toBe(true);
  });

  it('popup leaving fold progress tracks turn progress (inverse)', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, POPUP_SPREAD);

    book.startTurn();
    book.updateTurningPage(0.3);
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.7, 1);

    book.updateTurningPage(0.9);
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.1, 1);
  });

  it('fan turn arriving at popup spread unfolds popup', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 5);

    // Fan forward 2 pages: 5 → 7 (POPUP_SPREAD)
    book.startFanTurn(2, false);
    book.updateFanTurn(0.5);
    // Fan arriving — fold should track progress
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.5, 1);

    book.updateFanTurn(1.0);
    book.completeFanTurn();
    expect(book.getState().getStateIndex()).toBe(POPUP_SPREAD);
    expect(book.isPopupVisible()).toBe(true);
    expect(book.getPopupFoldProgress()).toBe(1);
  });

  it('fan turn leaving popup spread folds popup', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, POPUP_SPREAD);
    expect(book.isPopupVisible()).toBe(true);

    book.startFanTurn(2, false);
    book.updateFanTurn(0.5);
    // Leaving: fold = 1 - progress
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.5, 1);

    book.updateFanTurn(1.0);
    book.completeFanTurn();
    expect(book.getState().getStateIndex()).toBe(POPUP_SPREAD + 2);
    expect(book.isPopupVisible()).toBe(false);
  });

  it('fan passing through popup spread does not leave popup visible', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 5);

    // Fan forward 4: 5 → 9, passing through 7 (POPUP_SPREAD)
    // maxFanCount may limit this, so try what we can
    const max = book.getMaxFanCount(false);
    const count = Math.min(4, max);
    if (count >= 3) {
      // Fanning from 5 past 7 to 8+
      book.startFanTurn(count, false);
      book.updateFanTurn(1.0);
      book.completeFanTurn();
      // Landing past popup spread — popup should NOT be visible
      expect(book.getState().getStateIndex()).toBe(5 + count);
      if (5 + count !== POPUP_SPREAD) {
        expect(book.isPopupVisible()).toBe(false);
      }
    }
  });

  it('cancel fan arriving at popup spread hides popup', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 5);

    book.startFanTurn(2, false);  // 5 → 7
    book.updateFanTurn(0.5);
    expect(book.getPopupFoldProgress()).toBeCloseTo(0.5, 1);

    book.cancelFanTurn();
    // Should revert to j=5, popup should be hidden
    expect(book.getState().getStateIndex()).toBe(5);
    expect(book.isPopupVisible()).toBe(false);
    expect(book.getPopupFoldProgress()).toBe(0);
  });

  it('reverse fan arriving at popup spread from above', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 9);

    // Reverse fan 2: 9 → 7 (POPUP_SPREAD)
    book.startFanTurn(2, true);
    book.updateFanTurn(1.0);
    book.completeFanTurn();
    expect(book.getState().getStateIndex()).toBe(POPUP_SPREAD);
    expect(book.isPopupVisible()).toBe(true);
    expect(book.getPopupFoldProgress()).toBe(1);
  });
});

// ── Video Spread Fan Pass-Through ────────────────────────────────────────────

describe('Book - Video Spread Pass-Through (state level)', () => {
  // VIDEO_SPREAD = 7 in main.ts.  At the BookState level, fans that pass
  // through a spread without landing leave j !== 7, so checkVideoSpread()
  // in main.ts correctly ignores the pass-through.  These tests verify the
  // state-level invariant that j reflects the final landing position.

  it('fan that lands on VIDEO_SPREAD sets j correctly', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 5);
    book.startFanTurn(2, false);
    book.updateFanTurn(1.0);
    book.completeFanTurn();
    expect(book.getState().getStateIndex()).toBe(7);
  });

  it('fan that passes through VIDEO_SPREAD does not land on it', () => {
    const book = new Book({ numLeaves: 10, pageWidth: 1.0 });
    goToSpread(book, 5);
    const max = book.getMaxFanCount(false);
    if (max >= 3) {
      book.startFanTurn(3, false);
      book.updateFanTurn(1.0);
      book.completeFanTurn();
      expect(book.getState().getStateIndex()).toBe(8);
      // j !== 7, so checkVideoSpread() in main.ts would not trigger
    }
  });
});
