/**
 * BindingConstraint.ts — pure-math detector for the bend-binding-tangent
 * regime described in `docs/prd-page-model.md` ("Bend-binding-tangent
 * constraint" section, FR-P6 / FR-P7).
 *
 * No Three.js imports. No side effects. Operates on plain scalars in
 * page-local units (pageWidth = 1 by convention).
 *
 * ## Motivation (user observation, 2026-05-14)
 *
 * Real paper, when curled toward the spine, cannot push its bend past the
 * top/bottom of the binding without tearing. The bend is a (developable)
 * cylinder of radius `R` whose surface consumes vertical space along the
 * binding. When the bend's footprint on the spine reaches the binding
 * endpoint (a corner at `(0, ±H/2)` in page-local coords), real paper
 * forces the user's hand to pivot around that corner — the in-page DOF of
 * the crease's spine anchor migrates from a freely-chosen `anchorY` to
 * the binding endpoint, and further turning is rotation around that
 * corner rather than further tilt.
 *
 * ## Geometry (Regime I → Regime II)
 *
 * Setup, in page-local coords with the spine along the y-axis at x=0:
 *   - origin    = (0, anchorY) is the per-gesture spine anchor (Option B
 *                 from PR #82; pinned at pointerdown).
 *   - creaseDir = (sin θ, cos θ), tilt angle θ measured from spine.
 *                 θ=0 ⇒ crease ‖ spine (the easy case).
 *   - The flap occupies the +x half of the page when n̂ = (cos θ, −sin θ).
 *   - The cylindrical curl has radius R, axis parallel to creaseDir, and
 *     the curl arc subtends dihedral φ ∈ [0, π].
 *
 * The curl introduces a *lateral reach* into the flap: the point at
 * arc-length s, after the φ-rotation, sits at perpendicular displacement
 * R·sin(φ) (post-rotation projection of `R sin(s/R) n̂' + R(1−cos(s/R)) b̂'`
 * back onto the rest n̂ direction at the curl's apex, s* = R·π/2). When
 * the crease is tilted by θ, this lateral reach projects onto the spine
 * direction with factor |sin θ|, so the bend's *spine footprint* extends
 * from `anchorY` by at most
 *
 *     ΔY_max(φ) = R · sin(φ) · |sin θ|
 *
 * in the direction the flap leans toward (sign(sin θ) selects bottom vs.
 * top corner — see implementation for sign convention).
 *
 * ### Regime II (tangent) condition
 *
 * The bend reaches the binding endpoint corner when this lateral reach
 * exceeds the remaining distance from the anchor to that corner:
 *
 *     **R · sin(φ) · |sin θ|  ≥  H/2 ∓ anchorY**           (tangent condition)
 *
 *     (top: ∓ = −, bottom: ∓ = +)
 *
 * Equivalent threshold form, given `R, θ, anchorY`:
 *
 *     sin φ_crit = (H/2 ∓ anchorY) / (R · |sin θ|).
 *
 * For `R < R_c = (H/2 ∓ anchorY) / |sin θ|` the bend never reaches the
 * binding corner over φ ∈ [0, π/2]. For R ≥ R_c tangency happens at some
 * φ_crit ≤ π/2. Doubling R halves sin φ_crit — directly confirming the
 * user's observation that a higher hand (looser curl, larger R) hits
 * tangency at a smaller φ.
 *
 * ## Regime semantics
 *
 *   - 'free'           — Regime I. The Option B anchor is honored, the
 *                        crease is free to tilt with the cursor, no
 *                        migration. This is what PR #82 implements today.
 *   - 'tangent-top'    — Regime II at top. The crease's spine anchor must
 *                        migrate to (0, +H/2). Cursor's residual DOF
 *                        becomes a single rotation around that corner.
 *   - 'tangent-bottom' — Regime II at bottom. Symmetric.
 *
 * `migrated_anchor_y` is the y-coordinate the renderer should use for the
 * crease's spine intersection:
 *   - Regime I:  equals the input `anchorY`.
 *   - Regime II: equals ±H/2.
 *
 * `residual_phi` is the dihedral angle that the renderer should apply
 * given the migrated anchor:
 *   - Regime I:  equals the input `phi`.
 *   - Regime II: equals the input `phi` (this module's job is detection
 *                only; how to re-interpret cursor motion as rotation
 *                around the corner is the renderer's responsibility, and
 *                is intentionally deferred — see PRD FR-P7 and the
 *                "Conceptual fix" section of the PR description).
 *
 * ## Out of scope (deferred to the renderer fix)
 *
 *   - Re-projecting the cursor onto the feasible-drag arc.
 *   - Continuously blending the rotation axis as we cross the threshold.
 *   - Handling the case where `anchorY` itself is *outside* [−H/2, +H/2]
 *     at gesture start (the renderer should never produce such an anchor,
 *     but a defensive clamp is cheap).
 */

export type Regime = 'free' | 'tangent-top' | 'tangent-bottom';

export interface RegimeDetectInput {
  /** Page width in page-local units. Used for unit symmetry; not (yet) in the inequality. */
  W: number;
  /** Page height in page-local units. */
  H: number;
  /** Curl radius (FLAT_RADIUS for "essentially flat"). */
  R: number;
  /** Per-gesture spine anchor y-coordinate (PR #82 Option B). */
  anchorY: number;
  /** Crease tilt angle from the spine, in radians. Sign matters. */
  theta: number;
  /** Current dihedral angle, in radians, [0, π]. */
  phi: number;
}

export interface RegimeDetectResult {
  regime: Regime;
  /**
   * y-coordinate the renderer should use for the crease's spine
   * intersection. In Regime I this is the input `anchorY`; in Regime II
   * it is the binding endpoint (±H/2) that the anchor has migrated to.
   */
  migrated_anchor_y: number;
  /**
   * The dihedral angle to apply. Currently equal to the input `phi` in
   * both regimes — this field exists so a future renderer fix can split
   * the cursor's contribution between "more tilt" (Regime I) and "more
   * rotation around the corner" (Regime II) without changing the
   * function signature.
   */
  residual_phi: number;
  /**
   * Tangent-condition LHS − RHS in the units of the inequality. > 0 means
   * we are in Regime II (the bend has crossed the binding corner). Useful
   * for the renderer to detect the crossing event and snap continuously.
   */
  tangentMargin: number;
}

/**
 * Detect whether the current drag state is in the free regime or has
 * crossed into the tangent regime, and if the latter, which corner.
 *
 * The condition is symmetric in the sign of θ: tilt toward +x at the top
 * (sin θ > 0 with our convention, but see CreaseGeometry's `y >= 0` flip
 * — what matters here is which side of the spine the flap leans toward
 * as s grows) selects the *bottom* corner, and vice versa. The unit
 * tests pin both signs explicitly.
 */
export function regimeDetect(input: RegimeDetectInput): RegimeDetectResult {
  const { H, R, anchorY, theta, phi } = input;

  // sinθ = 0 degenerates to the spine-parallel case — A(s,φ) has no
  // y-projection, so the bend never reaches the binding corner. Return
  // free unconditionally.
  const sinT = Math.sin(theta);
  if (Math.abs(sinT) < 1e-9) {
    return {
      regime: 'free',
      migrated_anchor_y: anchorY,
      residual_phi: phi,
      tangentMargin: -Infinity,
    };
  }

  // Lateral curl reach projected onto the spine direction:
  //     ΔY_max(φ) = R · sin(φ) · |sin θ|.
  // Clamp sin(φ) to [0, 1] over φ ∈ [0, π] (it peaks at π/2 and is
  // symmetric); the renderer's φ is always in [0, π] but be defensive.
  const phiClamped = Math.max(0, Math.min(Math.PI, phi));
  const sinPhi = Math.sin(phiClamped);
  const reach = R * sinPhi * Math.abs(sinT);

  // Each corner gets its own threshold. The bend leans toward the corner
  // whose sign of sin θ matches: sin θ > 0 ⇒ bend's y-footprint moves
  // toward -y (bottom corner); sin θ < 0 ⇒ moves toward +y (top corner).
  const distToTop = H / 2 - anchorY;
  const distToBottom = H / 2 + anchorY;

  const topLhs = sinT < 0 ? reach : 0;
  const topMargin = topLhs - distToTop;

  const botLhs = sinT > 0 ? reach : 0;
  const botMargin = botLhs - distToBottom;

  if (topMargin >= 0 && topMargin >= botMargin) {
    return {
      regime: 'tangent-top',
      migrated_anchor_y: H / 2,
      residual_phi: phi,
      tangentMargin: topMargin,
    };
  }
  if (botMargin >= 0) {
    return {
      regime: 'tangent-bottom',
      migrated_anchor_y: -H / 2,
      residual_phi: phi,
      tangentMargin: botMargin,
    };
  }
  return {
    regime: 'free',
    migrated_anchor_y: anchorY,
    residual_phi: phi,
    tangentMargin: Math.max(topMargin, botMargin),
  };
}

/**
 * The critical dihedral at which the bend first touches the binding
 * corner, given (R, θ, anchorY, H). Returns NaN if no such φ ∈ [0, π/2]
 * exists (R is too small for the bend to reach the corner over a half
 * rotation).
 *
 * Formula:  sin φ_crit = (H/2 ∓ anchorY) / (R · |sin θ|)
 * where ∓ is − for the top corner and + for the bottom.
 */
export function criticalPhi(
  R: number,
  theta: number,
  anchorY: number,
  H: number,
  corner: 'top' | 'bottom',
): number {
  const sinT = Math.abs(Math.sin(theta));
  if (sinT < 1e-9 || R <= 0) return NaN;
  const dist = corner === 'top' ? H / 2 - anchorY : H / 2 + anchorY;
  const s = dist / (R * sinT);
  if (s > 1 || s < 0) return NaN;
  return Math.asin(s);
}

/**
 * Critical curl radius below which tangency never occurs for any φ in
 * [0, π/2]. At R = R_c, tangency occurs exactly at φ = π/2 (peak lateral
 * reach). For R > R_c tangency occurs at smaller φ.
 *
 *     R_c = (H/2 ∓ anchorY) / |sin θ|
 */
export function criticalRadius(
  theta: number,
  anchorY: number,
  H: number,
  corner: 'top' | 'bottom',
): number {
  const sinT = Math.abs(Math.sin(theta));
  if (sinT < 1e-9) return Infinity;
  const dist = corner === 'top' ? H / 2 - anchorY : H / 2 + anchorY;
  return dist / sinT;
}
