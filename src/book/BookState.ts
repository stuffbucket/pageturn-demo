/**
 * BookState.ts - Discrete state machine for the book from Section 1 of the formalization
 * 
 * j in {-1, 0, 1, ..., n, n+1} tracks which spread is visible
 * -1: front cover closed
 * 0: open to first spread
 * k (1..n-1): open to spread k
 * n: open to last spread
 * n+1: back cover closed
 */

// ── Physical material properties ─────────────────────────────────────────────
// Impulse propagation through a stack:
//   J_i = μ^i · J_0       impulse at page i (friction coupling decay)
//   page turns when J_i ≥ m_i · v_min
//
// Interior pages: m = m_page  (light, ~80 gsm paper)
// Covers:         m = m_cover (rigid board, ~2.5 mm greyboard + cloth + adhesive)
//
// The cover is so heavy relative to paper that μ^k · J_0 can never overcome
// m_cover · v_min — fans naturally stop at the cover without a special case.

export interface LeafMaterial {
  /** Mass per leaf in grams. Interior pages ≈ 4.5 g, covers ≈ 45 g. */
  mass: number;
}

export interface BookMaterial {
  /** Material for each interior leaf (paper). */
  page: LeafMaterial;
  /** Material for the front and back covers (board). */
  cover: LeafMaterial;
  /** Page-to-page static friction coefficient (0,1]. Lower = fewer pages per fan. */
  mu: number;
  /** Applied impulse at the first page (g·m/s). Represents finger force × contact time. */
  J0: number;
  /** Minimum velocity to initiate a page turn (m/s). */
  vMin: number;
}

/** Sensible defaults for a hardcover book with 80 gsm coated paper. */
export const DEFAULT_BOOK_MATERIAL: BookMaterial = {
  page:  { mass: 4.5 },   // ~80 gsm, 210×297 mm leaf
  cover: { mass: 45 },    // ~2.5 mm greyboard + cloth
  mu:    0.62,            // paper-on-paper kinetic friction ≈ 0.4–0.7
  J0:    30,             // finger impulse (g·m/s)
  vMin:  1.2,            // minimum turn velocity (m/s)
};

/**
 * Compute the maximum number of leaves a single fan gesture can turn,
 * given the impulse chain through friction coupling.
 *
 * At page i, available impulse: J_i = μ^i · J_0
 * Page turns when: J_i ≥ m_i · v_min
 *
 * Returns the largest k where all k pages can be turned.
 *
 * The cover is included in the mass model — its high inertia
 * (m_cover >> m_page) naturally halts the chain without special-casing.
 * A direct grab on any individual leaf (including the cover) always
 * works — the impulse limit only governs indirect drag through
 * page-to-page friction.
 */
export function maxFanCount(
  fromJ: number,
  numLeaves: number,
  forward: boolean,
  mat: BookMaterial = DEFAULT_BOOK_MATERIAL,
): number {
  let count = 0;
  let j = fromJ;

  while (true) {
    const nextJ = forward ? j + 1 : j - 1;

    // Hard bounds of the state space: can't go past the closed covers.
    if (nextJ < -1 || nextJ > numLeaves + 1) break;

    // Identify which physical leaf is being moved.
    // A leaf sits between spreads (a, a+1). It's a cover when
    // a = -1 (front cover) or a = n (back cover).
    // Forward from j: moving leaf(j, j+1)  → leafEdge = j
    // Reverse from j: moving leaf(j-1, j)  → leafEdge = j-1 = nextJ
    const leafEdge = forward ? j : nextJ;
    const isCover = (leafEdge === -1) || (leafEdge === numLeaves);
    const leafMass = isCover ? mat.cover.mass : mat.page.mass;

    // Impulse available at this position in the friction chain
    const Ji = Math.pow(mat.mu, count) * mat.J0;
    // Impulse needed to accelerate this leaf to minimum turn velocity
    const Jneeded = leafMass * mat.vMin;

    // If friction can't supply enough impulse, the chain stops here.
    // For covers, m_cover · v_min >> μ^k · J_0 for any realistic k,
    // so the fan naturally stops before closing the book.
    if (Ji < Jneeded) break;

    count++;
    j = nextJ;
  }

  return count;
}

export interface ContentPair {
  left: string | null;
  right: string | null;
}

export class BookState {
  private j: number;            // current discrete state
  private phi: number = 0;      // current rotation angle [0, PI]
  private numLeaves: number;    // n in the formalization
  private isTurning: boolean = false;
  private isReverseTurn: boolean = false;  // Track if current turn is reverse
  private fanCount: number = 1; // Number of leaves in current turn (1 = normal, >1 = fan)

  constructor(numLeaves: number) {
    this.numLeaves = numLeaves;
    this.j = -1;  // start with front cover closed
  }

  /**
   * Get the current discrete state index
   */
  getStateIndex(): number {
    return this.j;
  }

  /**
   * Get the current rotation angle in radians [0, PI]
   */
  getRotationAngle(): number {
    return this.phi;
  }

  /**
   * Get the turning progress as [0, 1]
   */
  getTurningProgress(): number {
    return this.phi / Math.PI;
  }

  /**
   * Check if currently turning
   */
  getIsTurning(): boolean {
    return this.isTurning;
  }

  /**
   * True if the current turn is a reverse (backward) turn.
   * Meaningless when isTurning is false.
   */
  getIsReverseTurn(): boolean {
    return this.isReverseTurn;
  }

  /**
   * Advance the turn progress.  Updates phi only — does NOT transition
   * state.  Call completeTurn() or cancelTurn() to finalize.
   */
  setTurningProgress(progress: number): void {
    if (!this.isTurning) return;

    const clampedProgress = Math.max(0, Math.min(1, progress));

    if (this.isReverseTurn) {
      // Reverse turn: phi goes π → 0 as progress goes 0 → 1
      this.phi = Math.PI * (1 - clampedProgress);
    } else {
      // Forward turn: phi goes 0 → π as progress goes 0 → 1
      this.phi = Math.PI * clampedProgress;
    }
  }

  /**
   * Start a page turn (forward)
   * Returns false if already turning or at the end of the book
   */
  startTurn(): boolean {
    if (this.isTurning || this.j >= this.numLeaves + 1) {
      return false;
    }
    this.phi = 0;
    this.isTurning = true;
    this.isReverseTurn = false;
    this.fanCount = 1;
    return true;
  }

  /**
   * Start a reverse page turn (backward)
   * Returns false if already turning or at the beginning of the book
   * 
   * Note: j decrements immediately because we've already moved to the previous spread;
   * during the animation, phi goes from π to 0
   */
  startReverseTurn(): boolean {
    if (this.isTurning || this.j < -1) {
      return false;
    }
    // Immediately move to previous state, then animate the reverse
    this.j--;
    this.phi = Math.PI;
    this.isTurning = true;
    this.isReverseTurn = true;
    this.fanCount = 1;
    return true;
  }

  /**
   * Start a fan turn: turn `count` pages forward simultaneously.
   *
   * Fan turns require an interior starting spread (j in {0..n}).
   * The count should come from maxFanCount(), which limits it based
   * on impulse propagation — the cover's inertia naturally halts the
   * chain before the book can close. The j-bounds here are a secondary
   * invariant, not the primary physics.
   */
  startFanTurn(count: number): boolean {
    if (this.isTurning || count < 1) return false;
    // Must start from an interior spread.
    if (this.j < 0 || this.j > this.numLeaves) return false;
    // Cannot fan past the last interior spread.
    if (this.j + count > this.numLeaves) return false;
    this.phi = 0;
    this.isTurning = true;
    this.isReverseTurn = false;
    this.fanCount = count;
    return true;
  }

  /**
   * Start a reverse fan turn: turn `count` pages backward simultaneously.
   *
   * Fan turns require an interior starting spread (j in {0..n}).
   * The count should come from maxFanCount(), which limits it based
   * on impulse propagation — the cover's inertia naturally halts the
   * chain before the book can close. The j-bounds here are a secondary
   * invariant, not the primary physics.
   */
  startReverseFanTurn(count: number): boolean {
    if (this.isTurning || count < 1) return false;
    // Must start from an interior spread.
    if (this.j < 0 || this.j > this.numLeaves) return false;
    // Cannot fan past the first interior spread.
    if (this.j - count < 0) return false;
    this.j -= count;
    this.phi = Math.PI;
    this.isTurning = true;
    this.isReverseTurn = true;
    this.fanCount = count;
    return true;
  }

  /** Number of leaves being turned in the current (fan) turn. */
  getFanCount(): number {
    return this.fanCount;
  }

  /**
   * Check if can turn forward
   */
  canTurnForward(): boolean {
    return this.j < this.numLeaves + 1 && !this.isTurning;
  }

  /**
   * Check if can turn backward
   */
  canTurnBackward(): boolean {
    return this.j > -1 && !this.isTurning;
  }

  /**
   * Get the visible content pair for the current state
   * left page, right page (as page numbers, or "cover_front_ext", "cover_back_int", etc.)
   */
  getVisibleContent(): ContentPair {
    const j = this.j;

    if (j === -1) {
      return { left: null, right: 'cover_front_ext' };
    } else if (j === 0) {
      return { left: 'cover_front_int', right: 'p1' };
    } else if (j >= 1 && j <= this.numLeaves - 1) {
      const leftPageNum = 2 * j;
      const rightPageNum = 2 * j + 1;
      return { left: `p${leftPageNum}`, right: `p${rightPageNum}` };
    } else if (j === this.numLeaves) {
      const lastPageNum = 2 * this.numLeaves;
      return { left: `p${lastPageNum}`, right: 'cover_back_int' };
    } else if (j === this.numLeaves + 1) {
      return { left: 'cover_back_ext', right: null };
    }

    return { left: null, right: null };
  }

  /**
   * Get the page being turned during an animation
   * Returns the page index (number) that is being turned to the next state
   */
  getTurningPageIndex(): number {
    if (this.isTurning && this.j >= 0 && this.j < this.numLeaves) {
      return this.j + 1;
    }
    return -1;
  }

  /**
   * Get a human-readable description of the current state
   */
  getStateDescription(): string {
    if (this.j === -1) {
      return 'Closed (Front Cover)';
    } else if (this.j === this.numLeaves + 1) {
      return 'Closed (Back Cover)';
    } else if (this.j === 0) {
      return 'Open to First Spread';
    } else if (this.j === this.numLeaves) {
      return 'Open to Last Spread';
    } else {
      return `Open to Spread ${this.j} (Pages ${2 * this.j}-${2 * this.j + 1})`;
    }
  }

  /**
   * Get the total number of states
   */
  getTotalStates(): number {
    return this.numLeaves + 2; // -1 to n+1
  }

  /**
   * Finalize a completed turn.  Advances j by fanCount (forward) or
   * confirms the pre-decremented j (reverse).
   * This is the SOLE method that transitions j on turn completion.
   */
  completeTurn(): void {
    if (!this.isTurning) return;
    if (this.isReverseTurn) {
      // j was already decremented in startReverseTurn/startReverseFanTurn
      this.phi = 0;
    } else {
      this.j += this.fanCount;
      this.phi = Math.PI;
    }
    this.isTurning = false;
    this.isReverseTurn = false;
    this.fanCount = 1;
  }

  /**
   * Cancel an in-progress turn and revert j and phi to the resting state
   * before the turn started.
   */
  cancelTurn(): void {
    if (!this.isTurning) return;
    if (this.isReverseTurn) {
      // startReverseTurn/startReverseFanTurn decremented j — put it back
      this.j += this.fanCount;
    }
    this.phi = 0;
    this.isTurning = false;
    this.isReverseTurn = false;
    this.fanCount = 1;
  }
}
