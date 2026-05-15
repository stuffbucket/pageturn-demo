# Multi-Angle Camera Capture — Observations

Date: 2026-05-14
Capture run: `npm run multi-angle:capture` (commit `bc694c2*` of branch `worktree-agent-acd34795d6acb5aa9`)
Artifacts: [`contrib/debug/multi-angle/`](../contrib/debug/multi-angle/)

## Setup

A canonical vertical-biased drag from near the top-right corner of the right page (the canonical (0.5, +/-0.4) gesture from issue #76 that surfaces the originY-mouse-follow / off-spine-pivot bug) is replayed once per camera preset. The drag is recorded in the front view via real pointer events, then replayed deterministically against the Book API (`book.startTurn()` + `book.updateTurningDrag(...)`) for the other seven presets so the page state is identical at each checkpoint regardless of camera. Screenshots are captured at seven dihedral checkpoints (t = 400, 700, 1000, 1300, 1600, 1900, 2200 ms).

The fiducial overlay (`?fiducials=1`) and HUD (`?debug=1`) are baked into every capture so each PNG is self-describing — `dihedral`, `originY`, `creaseDir`, and `dragPoint` are all readable straight off the image.

## What each angle reveals

| Preset | Bug it surfaces |
|---|---|
| `front` | Back-face bleed (#65), cover gradient continuity. Hides pivot-axis defects entirely. |
| `top` | **Off-spine pivot (#68/#76).** The spine should be a vertical line at x=0; a pivot that drifts off the spine is immediate from above. Also makes originY drift visible as a y-axis offset of the rotation axis. |
| `side-spine` | Curl shape and z-axis drift. Curl-into-tube regressions (PR #59 history) read as a coil; aerodynamic-settle bend amplitude reads cleanly here. |
| `side-corner` | Drag-axis vs dihedral-axis alignment. Pulls that should hinge at 45° but instead hinge at 90° show as a misaligned crease line. |
| `three-quarter` | General-purpose evidence thumbnail. Shows back-face issues and curl shape simultaneously without exaggerating either. |
| `worm` | Back-face texture sampling (PR #74 territory), missing n+1 leaf (#54/#58), bleed-through from below. |
| `behind` | Back-face *of the back face* — confirms whether the texture is mirrored correctly when seen from the opposite side. |
| `iso` | Equal-axis foreshortening; the canonical comparison frame for cross-run side-by-side diffs. |

## Surprises (bugs visible from one angle and not another)

1. **`worm` shows fiducial dots floating above the back-face surface.** At `worm__t1300.png` the fiducials on the curling page appear at positions inconsistent with the page-mesh edges — they look "behind" the surface from the worm angle even though they're baked into the texture. Hypothesis: the fiducials are drawn into the front-face texture only, and from below the back-face shows through the polygon-offset gap. This is invisible from `front` and `three-quarter` because the front face is occluding the back. **Open question for #54 / #74:** is the back-face sampling the right atlas tile but with the wrong UV winding?

2. **`top` reveals that the static spread continues to render the right page even when the turning page is past dihedral=90°.** At `top__t1300.png` (dihedral=128.3°) the right-half static spread is still visible *behind* the rotated turning page — the n+1 leaf is missing as a visible quad below it. From `front` this is hidden because the static spread occupies the same screen pixels as the turning page back face. This corroborates **#54 / #58** ("turning page is missing the n+1 leaf during the fold") with an unambiguous geometric witness.

3. **`side-spine` at progress=1.0 (t=1900, dihedral=180°) shows a non-zero z-coordinate offset of the turning page versus the static spread.** The two surfaces should be co-planar at dihedral=π but the side-edge shows a small offset — the polygonOffset (factor/units = -2) is doing its job for visibility, but it visibly breaks coplanarity at edge-on angles. Possibly contributes to the residual bleed-through called out by **#65**.

4. **`top` shows the crease-arrow (HUD-rendered creaseDir) pointing in a direction that is NOT perpendicular to the visible crease line of the turning page** at moments where originY is materially > 0. This is the fingerprint of the **#76 originY-mouse-follow** behaviour: the rotation axis is being computed in the tilted frame but the screen-space crease appears at the wrong angle when projected to top-down view. The mismatch is invisible from `front` and `three-quarter` but stark from `top`.

5. **`behind` view shows the cover gradient on the back face of the cover renders correctly oriented (text "WANDERLUST" reads right-to-left in screen space, as expected for back-face viewing).** This was an open concern after PR #74; the `behind` view confirms the fix held.

## Recommended default for future bug-evidence captures

For single-frame issue evidence: **`three-quarter`** (`?camera=three-quarter`) is the best general-purpose default. It shows curl shape, both faces, and the crease line in one image without hiding any commonly-broken invariant.

For pivot-axis bugs (#68/#76, #50 originY area-growth): **`top`** is the only angle that makes the defect unambiguous in a single frame.

For curl-shape and settle-physics bugs (#19, #51, #57, PR #59 regression): **`side-spine`** edge-on is the only angle that resolves curl character without perspective ambiguity.

For back-face / n+1 leaf bugs (#54, #58, #65, #74): **`worm`** or **`behind`** — pick the one where the back face is the front-most surface, which depends on the dihedral at the moment of interest.

A prudent convention going forward: when filing a new render-bug issue, attach a **2x2 grid: front + top + side-spine + worm**. Four PNGs, generated with `npm run multi-angle:capture -- --presets front,top,side-spine,worm`.

## How to reproduce

```bash
# 1. dev server in another terminal
npm run dev

# 2. capture (writes contrib/debug/multi-angle/ — 56 PNGs + index.html)
npm run multi-angle:capture
open contrib/debug/multi-angle/index.html
```

Or one preset at a time:

```bash
npm run multi-angle:capture -- --presets top,worm
```

Live exploration (any URL flag combo):

```
http://localhost:5173/?camera=top
http://localhost:5173/?camera=worm&debug=1&fiducials=1
```

The `?camera=` flag is read once at boot. Non-`front` presets relax the OrbitControls polar-angle clamps to 0..π and disable the controls entirely so the camera stays put — see `src/main.ts` adjacent to `applyCameraPreset(...)`.
