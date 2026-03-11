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
   * Advance the turn progress
   */
  setTurningProgress(progress: number): void {
    // Clamp progress to [0, 1]
    const clampedProgress = Math.max(0, Math.min(1, progress));
    
    if (this.isTurning && this.j >= -1 && this.j <= this.numLeaves + 1) {
      if (this.isReverseTurn) {
        // Reverse turn: phi goes π → 0 as progress goes 0 → 1
        // j was already decremented in startReverseTurn()
        this.phi = Math.PI * (1 - clampedProgress);
      } else {
        // Forward turn: phi goes 0 → π as progress goes 0 → 1
        this.phi = Math.PI * clampedProgress;
      }
      
      // Turn completes when progress >= 1
      if (clampedProgress >= 1) {
        if (this.isReverseTurn) {
          // Reverse turn complete: j was already decremented in startReverseTurn
          // phi stays at 0 (page is now in the previous state)
          this.isReverseTurn = false;
        } else {
          // Forward turn complete: increment state
          // phi stays at π (page is fully turned, waiting for next turn)
          this.j++;
        }
        this.isTurning = false;
      } else {
        // Turn is still in progress
        this.isTurning = true;
      }
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
    return true;
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
   * Finalize a completed turn.  Ensures j is advanced (forward) and
   * isTurning is cleared, even if setTurningProgress never reached
   * exactly 1.0 (e.g. physics settle terminating at 0.999).
   */
  completeTurn(): void {
    if (!this.isTurning) return;
    if (this.isReverseTurn) {
      // j was already decremented in startReverseTurn — nothing more to do.
      this.phi = 0;
    } else {
      this.j++;
      this.phi = Math.PI;
    }
    this.isTurning = false;
    this.isReverseTurn = false;
  }

  /**
   * Cancel an in-progress turn and revert j and phi to the resting state
   * before the turn started.
   */
  cancelTurn(): void {
    if (!this.isTurning) return;
    if (this.isReverseTurn) {
      // startReverseTurn() decremented j — put it back
      this.j++;
    }
    this.phi = 0;
    this.isTurning = false;
    this.isReverseTurn = false;
  }
}
