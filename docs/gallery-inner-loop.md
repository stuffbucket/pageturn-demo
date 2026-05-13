# Inner-loop tooling visual gallery

A glance-able reference for the in-browser dev tools that ship with the page-turn
demo. Each section shows the tool, what it looks like, and when to reach for it.
All flags can be combined (e.g. `?debug=1&fiducials=1&capture=1&telemetry=1`).

> All screenshots below are pinned to commit `__COMMIT_SHA__` on branch
> `docs/inner-loop-gallery`, so the embedded raw-URL references remain valid
> after the branch is deleted post-merge.

---

## 1. Debug HUD (`?debug=1`)

![Debug HUD](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/01-debug-hud.png)

A top-right overlay that mirrors the live state machine: `BookState` (`j`,
`phi`, turning/settling flags), the active drag (`dragPoint`, `progress`,
`velocity`), the tilted-crease geometry (`alpha`, `dihedral`, `originY`),
camera pose, and a 1 Hz FPS sample. Reach for it any time the visible
animation looks wrong — the HUD typically pinpoints whether the issue is in
input (`drag`), the state machine (`turn`), or the crease math
(`crease.alpha`/`dihedral`). It also doubles as the host for the Build
section and the repro QR (see section 5).

## 2. Fiducial overlay (`?fiducials=1`)

![Fiducials](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/02-fiducials.png)

A 5x7 grid of labeled colored dots baked into every procedural page texture
(see `FIDUCIAL_US` / `FIDUCIAL_VS` in `src/textures/atlas.ts`). Use this when
investigating shader bugs that depend on `(u, v)` location — inextensibility
(do the dots stay equidistant during a turn?), houndstooth at the tilted
crease, polygon-offset bleed-through, or any other "where on the page is this
happening?" question. Toggle off when validating final visuals; the dots are
not meant to ship.

## 3. Telemetry pipeline (`?telemetry=1`)

![Telemetry tail](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/03-telemetry-tail.png)

Each event the demo emits (`boot`, `fps-sample`, `state-transition`,
`drag-start`, `pointer-move` @ 10 Hz, `drag-end`, `screenshot-captured`,
`error`) is POSTed to a Vite dev-server sink that appends one JSON object per
line to `/tmp/pageturn-telemetry.jsonl` (truncated on server start). Tail it
with `tail -f /tmp/pageturn-telemetry.jsonl | jq -c .` while reproducing a
bug to see exactly which state transitions fire and in what order. A clean
excerpt is checked in alongside this gallery as
[`03-telemetry-events.txt`](../contrib/debug/gallery/inner-loop/03-telemetry-events.txt):

```jsonl
{"ts":"...","type":"state-transition","op":"startTurn","j":-1,"phi":0,"isReverseTurn":false}
{"ts":"...","type":"drag-start","dragPoint":{"x":0.99,"y":0},"dragProgress":0,"reverse":false,"j":-1}
{"ts":"...","type":"pointer-move","dragPoint":{"x":0.97,"y":0.7},"crease":{"alpha":-1.5708,"originY":0.7,"dihedral":0.089},"dragProgress":0.028}
{"ts":"...","type":"drag-end","dragProgress":1,"dragVelocity":0,"reverse":false}
{"ts":"...","type":"fps-sample","fps":60}
```

## 4. Long-press screenshot capture (`?capture=1`)

![Long-press capture result](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/04-capture-result.png)

Hold the mouse motionless on the canvas for 5 seconds and the page flashes,
then a PNG plus a sidecar JSON land in `contrib/screenshots/`. The sidecar
embeds the full `BookState` snapshot, the camera, FPS, and the `build`
provenance (commit/branch/dirty/`worktreeLabel`/goal). Use this when you
catch the demo mid-glitch and want a reproducible record before the moment
slips — the agent who picks up the bug later can rewind to the exact tree
state. The session id (`?session=<tag>`) becomes the filename prefix.
Sidecar example: [`04-capture-sidecar.json`](../contrib/debug/gallery/inner-loop/04-capture-sidecar.json).

## 5. Build info + QR in HUD

![Build section + QR](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/05-build-info-qr.png)

The bottom of the `?debug=1` HUD includes a Build section (commit, branch,
dirty flag, worktree label, PR if any, and the `.build-goal` text) plus a QR
code that encodes a JSON repro recipe. Click the QR to copy the payload to
your clipboard; scan it from a phone to bookmark the exact tree state. This
is the lowest-friction way to capture "what code is this exactly?" when
sharing a screen recording or screenshot with another agent or Brian.
Decoded payload:
[`05-qr-decoded.json`](../contrib/debug/gallery/inner-loop/05-qr-decoded.json):

```json
{
  "v": 1, "kind": "pageturn-repro",
  "repo": "https://github.com/stuffbucket/pageturn-demo",
  "commit": "<full-sha>", "branch": "<branch>", "dirty": false,
  "pr": null, "goal": "<.build-goal text>",
  "url": "http://localhost:<port>/?debug=1&session=..."
}
```

## 6. Help-menu toggles (`H`)

![Help overlay](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/06-help-menu.png)

Press `H` to summon a left-side overlay with state readout, prev/next buttons,
FPS / current-page stats, and checkboxes that mirror every URL flag above
(Debug HUD, Fiducials, Long-press capture, Developable surface). Useful when
you want to flip a flag without rewriting the URL — fiducials and the
developable-surface flag trigger a reload so the change applies to texture
generation and shader selection. Reach for this when demo-ing to a human and
the URL bar is hidden, or when toggling state between captures.

## 7. Developable-surface flag (`?dev-surface=1`)

| `?dev-surface=0` (legacy `sin(2 phi)` curl) | `?dev-surface=1` (developable cylindrical curl) |
|---|---|
| ![sin2phi mid-turn](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/07-dev-surface-off.png) | ![developable mid-turn](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/__COMMIT_SHA__/contrib/debug/gallery/inner-loop/07-dev-surface-on.png) |

The feature flag that switches the turning-page vertex shader between the
legacy edge-bend (`phi(t) = uDihedral + uBendAmount * t * sin(2 * uDihedral)`)
and the developable / inextensible cylindrical curl tracked in
`docs/prd-page-model.md` (issue #18). Use it when validating that the new
model preserves arc-length where the old one stretches the page; compare the
two snapshots above (both captured mid-drag at the same drag point) — the
sin2phi model's free edge fans outward, while the developable model rolls
the leaf along a cylinder so the fiducial grid stays equidistant.

---

## Index

| File | Purpose |
|------|---------|
| `01-debug-hud.png` | Full `?debug=1` HUD |
| `02-fiducials.png` | 5x7 dot grid on a page surface |
| `03-telemetry-events.txt` | 10-line representative `/__telemetry` excerpt |
| `03-telemetry-tail.png` | Mock terminal showing `tail -f \| jq -c .` |
| `04-capture-result.png` | A real long-press capture |
| `04-capture-sidecar.json` | Its sidecar (full state + build provenance) |
| `05-build-info-qr.png` | HUD Build section + repro QR, cropped |
| `05-qr-decoded.json` | Decoded QR payload |
| `06-help-menu.png` | `H` overlay with checkbox toggles |
| `07-dev-surface-off.png` / `07-dev-surface-on.png` | Side-by-side mid-drag |
