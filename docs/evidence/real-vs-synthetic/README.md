# Real-vs-synthetic side-by-side composites

This directory is reserved for paired (real-paper, shader-rendered) frames that visually back the observations in `docs/real-paper-observations-2026-05-15.md`.

The follow-up captured in the tracking issue ("Capture real-paper page-turn reference data + cross-check against shader model") will land:

- `S2-mid-curl.jpg` — IMG_4117 alongside a `multi-angle:capture` render with a matching drag path.
- `S3-sharp-pinch.jpg` — IMG_4126.
- `S4-edge-on.jpg` — IMG_4129.
- `S5-palm-push.jpg` — IMG_4134.
- `S6-triangle-fold.jpg` — IMG_4140.

Source pairs use `magick montage` (or equivalent) at 1200 px wide, two-panel side-by-side, labelled "real" / "shader".
