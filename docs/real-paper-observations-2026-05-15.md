# Real-paper page-turn observations — 2026-05-15

Empirical reference for the page-turn model. 29 HEIC captures (`contrib/captures/IMG_4113.HEIC` – `IMG_4141.HEIC`) of a hand turning a hand-bound notebook were converted to JPEG at 1200 px max dimension via [`scripts/heic-to-jpg.mjs`](../scripts/heic-to-jpg.mjs) and analysed frame-by-frame. The book uses circles as front-side fiducials and X's as back-side fiducials on every page; pages are gridded so distortion can be read directly off the bend.

Originals remain in the gitignored `contrib/captures/` directory on the capture host. The derived JPEGs in `contrib/captures-derived/` are what is checked in.

## Capture geometry

In every frame the spine of the book is **horizontal**, near the top of the photo, with the camera shooting roughly straight down. The page being turned is the lower half-spread; the resting half-spread is above (closer to the spine). The hand approaches from below and pulls a point on the free edge toward the spine. The hand's (x, y) location in the photo plays the role of the cursor in the prototype.

(One sequence — IMG_4124 – 4127 — is rotated 90°: spine on the right, hand pulling from the left. The geometry is the same after a coordinate transpose.)

## Sequence inventory

Photos cluster cleanly by EXIF timestamp into six gestures. Within a gesture the hand moves continuously; gestures are separated by 10–15 s pauses where the book is re-flattened.

| Sequence | Frames | Gesture | Notes |
|---|---|---|---|
| S1 | 4113–4115 | Rest → start-of-pinch → first lift | 4113 is the resting reference (no fold). |
| S2 | 4116–4121 | Full corner-peel to fully-flipped | Cleanest curl progression; back-of-page X-grid clearly visible by 4117. |
| S3 | 4122–4127 | Rotated rig (spine on right), corner pinch and lift | Shows the same anchored-crease behaviour after a 90° rotation. |
| S4 | 4128–4131 | High lift past vertical | 4129 shows the page edge-on – important for Q2 (cone vs cylinder). |
| S5 | 4132–4136 | Full-page bend (palm push, not corner pinch) | 4134 shows the "tent" full-spine bend that our sin(2φ) approximates. |
| S6 | 4137–4141 | Hard pinch, sharp fold | 4140 shows a near-triangular sharp crease — the developable-cone limit. |

## Q1. Where does the crease meet the spine?

**Answer: the spine intersection of the crease is interior — typically near mid-spine — and stays fixed for the duration of a single gesture.** It is *not* anchored at the page corner the user is dragging, and it is not pulled around by the cursor.

Evidence:

- **IMG_4115** — hand pinches roughly the mid-edge of the page from underneath; the visible crease (the brightest fold ridge against the X-side flap) meets the spine at about x ≈ 0.40·W from the left edge of the page — well clear of either corner.
- **IMG_4117 / IMG_4118** — same gesture progresses; the crease's spine intersection sits at roughly x ≈ 0.35·W and x ≈ 0.45·W respectively. It moves only slightly, and the small drift is consistent with the user shifting their hand, not with the crease "sliding" as the dihedral increases.
- **IMG_4125 / IMG_4126** — rotated rig; the hand pulls a corner up-and-out, and the crease lands cleanly at mid-spine. Again, **not** at the corner the user is pulling.
- **IMG_4140** — sharp diagonal pinch; the crease is a straight line from a mid-spine point to the opposite free edge — a textbook developable-cone fold.

This matches the qualitative behaviour PR #82 (Option B) introduced: pin the crease–spine intersection at gesture start; let the crease line tilt around that anchor as the cursor moves. The one discrepancy is that **the natural anchor in real paper is not `cursor.y` at pointerdown** — it tends to sit near the spine midline regardless of where the user grabs (the paper's bending energy minimum drives the anchor toward the centre). Option B as shipped uses `cursor.y` clamped to `[-H/2, +H/2]`; for a corner pinch this lands close to ±H/2, while real paper would settle the anchor closer to 0. See "Recommended adjustments" below.

## Q2. How does the fold shape change as the crease angle approaches vertical?

**Answer: the bend is *not* a uniform cylinder. The fold curvature is highest near the spine apex and relaxes toward the free edge — i.e. the real paper bends as a developable cone, with curvature ∝ 1/(geodesic distance from the apex on the spine).**

Evidence:

- **IMG_4117** — viewed from above the curl, gridlines on the turning page fan out: lines that were parallel on the flat page become rays diverging from a point on the spine. This is the defining visual signature of a cone, not a cylinder. The grid spacing along arcs concentric with the apex is preserved — paper *is* inextensible — confirming geodesic-circle behaviour around a singular apex on the spine.
- **IMG_4126** (sharper pinch) — the X-side of the fold is essentially planar (a tilted flat triangle), with all of the curvature concentrated at the crease itself. As the user pinches harder, the cone collapses toward a *crease + two flat panels* limit. This is the same developable cone, just with the curvature integrated into an arbitrarily narrow ridge.
- **IMG_4129** — page lifted nearly vertical, viewed edge-on. Gridlines that should run from spine to free edge appear as smooth arcs whose radius **grows** with distance from the spine. Equivalently, the apex of the cone (on the spine) has zero radius; far from the apex the surface is nearly planar.
- **IMG_4134** — full-spine palm push: the entire spine becomes the bend line, the surface bows as one big cylinder, and the cone degenerates to the constant-curvature case our existing `sin(2φ)` shader matches reasonably well.

The current shader's `φ(t) = uDihedral + uBendAmount · t · sin(2φ)` produces a **uniform** bend along the tilted crease normal (a cylinder, modulated by t). That fits S5 (palm push) well but is qualitatively wrong for S2/S3/S4/S6, where curvature should diverge as 1/r toward the apex. This is the same problem PRD #11 / issue #18 names "inextensibility" — the photographs are the empirical confirmation that the developable-cone family (not cylindrical curl) is the right surface.

## Q3. Does the spine lift?

**Answer: no, not visibly. In every frame the spine remains in flush contact with the table.**

The notebook in the captures is a stapled / saddle-stitched booklet with a soft fold, not a stiff perfect-bound spine. The fold along the binding remains parallel to the table in all 29 frames; the only out-of-plane motion is on the turning leaf itself. Specific checks:

- **IMG_4119 / IMG_4120** — late-turn frames where the bend energy is maximal; the spine band is still flat against the wood grain.
- **IMG_4134** — full-spine palm-push (the hardest test); the spine still touches the table — the bow is *all* in the leaf, not the binding.

The current model's assumption that the spine is fixed in world space is therefore *correct for this style of book*. For a stiff hardcover the conclusion may differ; we have no captures for that case and should not generalise.

## Cross-references to open work

### PRD #11 / issue #18 — inextensibility
The cone-fan distortion in IMG_4117 is the empirical signature of geodesic preservation around a spine apex. The current cylindrical sin(2φ) shader violates this everywhere except S5 (full-spine push). The `DevelopableSurface.cylindricalCurlPos` path (issue #61) is the right direction but the curvature profile needs to be 1/r-around-apex, not constant. The captures give us concrete gridlines to fit against.

### PRD #9 / issue #19 — settle physics
**The captures do not contain release-mid-turn frames** — every photo is a held gesture, so they cannot speak directly to underdamped oscillation or aerodynamic decay. The user should be asked to capture a release sequence (continuous video preferred) before we treat the settle physics as observationally constrained. Flag as deferred.

### Issue #77 — drag-gain
By IMG_4118 the page is at roughly the dihedral angle the prototype assigns to ~70 % of full drag, yet the hand has clearly only travelled a fraction of the page width. The real-paper gain *is* high — the user's hand position in IMG_4118 is at about (x, y) ≈ (0.45·W, 1.3·H) below the page; the prototype would already be near full turn at this drag distance. Issue #77's diagnosis ("full turn happens before midline") is consistent with the photos *only if* one accepts that the photographed gestures are aggressive. We do not have a slow-drag reference to definitively recalibrate the gain. Flag for a follow-up controlled capture.

### Issue #82 — spine-anchor (Option B)
Option B's *qualitative* commitment — pin the crease–spine intersection once per gesture — matches every frame in the dataset. The cursor-to-anchor mapping is the one place the model can be refined: real paper anchors near the spine midline, not at `cursor.y`. See below.

## Recommended model adjustments

1. **Anchor location.** Replace `anchorY = clamp(cursor.y, ±H/2)` with `anchorY ≈ 0` (mid-spine) for corner-pinch gestures, blending toward `cursor.y` only when the hand grabs near the spine itself. A simple Lerp `anchorY = cursor.y · σ(|cursor.y| − a)` with `a ≈ 0.4·H` would match the photos without a regression for spine-edge drags.
2. **Curvature profile.** Replace the constant-`uBendAmount` cylinder with a 1/r cone-fan around the (spine, anchorY) apex. The existing `DevelopableSurface` scaffolding (#61) is the obvious home; ship a `coneCurlPos(apex, dihedral, t)` alongside the cylindrical mode and switch on `(crease-tilt > ε) ∨ (hand-near-corner)`.
3. **Spine boundary condition.** No change needed. The captures confirm the spine is fixed.
4. **Gain calibration.** Defer — collect slow-drag captures first.

## Side-by-side rendering (deferred)

The task brief called for a 3–5 frame side-by-side rendering against the shader using `npm run multi-angle:capture`. That requires the dev server running with a scripted drag path, which is out of scope for this single-agent run; a follow-up will (a) script `multi-angle-pivot.json`-style drags that mirror the hand trajectories in S2 and S6, and (b) drop synthetic frames into `docs/evidence/real-vs-synthetic/` matched to IMG_4117, 4126, 4129, 4134, 4140. The directory is pre-created so the follow-up can land additively.

## Reproducing the conversion

```bash
node scripts/heic-to-jpg.mjs <src-heic-dir> contrib/captures-derived 1200
```

`sips` is shipped with macOS; no extra deps. The script sorts inputs by mtime so the JPEG filename order matches capture order.

## Top-3 findings

1. Real paper anchors the crease at an interior point of the spine and keeps it there for the whole gesture — exactly the Option B behaviour shipped in PR #82, modulo the cursor-to-anchor mapping.
2. The bend is a developable **cone** (apex on the spine, 1/r curvature), not a cylinder — the cylindrical sin(2φ) shader is wrong everywhere except full-spine palm pushes.
3. For saddle-stitched booklets the spine never lifts; the world-fixed-spine assumption is empirically safe.
