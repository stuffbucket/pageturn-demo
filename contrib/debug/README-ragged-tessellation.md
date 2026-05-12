# ragged-tessellation visual evidence

Files
-----
- `ragged-before.png` — user's original on-hardware long-press capture
  (`anon-2026-05-12T22-19-46-475Z-localhost-5174-capture-1-debug-1.png`)
  taken from the deployed demo at commit `918af29` (main, pre-PR-#33).
  The accompanying `.png.json` sidecar is preserved verbatim. Note the
  sawtooth / "houndstooth" silhouette where the lifted front-cover meets
  the spine — that is the regression PR #33 aims to fix.
- `ragged-after.png` — Playwright capture of the same drag pattern
  (corner-peel diagonal pull on the closed front cover, held at peak
  dihedral) against the post-fix code at the head of branch
  `verify/ragged-tessellation-fix` (which sits on `origin/main` after PR
  #33 landed). The dark cover-back wedge is now a single contiguous shape
  with cleaner edges instead of the chunky blob-y silhouette of the
  pre-fix render.

Capturing comparable images
---------------------------
The pre-fix screenshot was a real interactive long-press from a host
browser at 1280×720. The post-fix capture is headless Chromium
(SwiftShader software WebGL) — the absolute pixel values differ from
hardware but the silhouette character is what we are comparing.

The regression assertion that backs this evidence lives at
`harness/scenarios/tilted-crease-boundary.json` and runs against the
SwiftShader render only — see the scenario `_notes` for why the
assertion uses `minTransitions` (the bug's chunky-blob signature
produces FEWER crisp edges, not more, in that environment).
