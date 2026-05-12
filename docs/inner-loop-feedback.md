# Inner-loop feedback guide

How an agent (or human) should debug the page-turn prototype efficiently.
The prototype ships four independent feedback streams that, together,
remove almost all need to ask the user "what did you see?" -- the
information is already on disk.

## Table of contents

1. [The four feedback streams](#the-four-feedback-streams)
2. [When to reach for each](#when-to-reach-for-each)
3. [Concrete agent recipe: investigating a UX bug](#concrete-agent-recipe-investigating-a-ux-bug)
4. [What NOT to do](#what-not-to-do)
5. [Cross-references](#cross-references)

---

## The four feedback streams

| Stream | Where it lives | Enable with | What it gives you |
|---|---|---|---|
| **Telemetry** | `/tmp/pageturn-telemetry.jsonl` (one JSON event per line) | `?telemetry=1` | Real-time event log: pointer events, turn start/complete/cancel, settle entry/exit, capture triggers. Streamed by the Vite dev plugin (see `vite.config.ts` ~line 18, 174). |
| **Debug HUD** | Top-left overlay in the running app | `?debug=1` | Live snapshot of the active state machine: spread index, dihedral, originY, settle phase, fan count. Visible in any screenshot. |
| **Long-press capture** | `contrib/screenshots/<session>-<n>.png` + `.json` sidecar | `?capture=1[&session=<name>]` | Press-and-hold the canvas to snapshot a single moment. The sidecar JSON contains the full state object (BookState fields, shader uniforms, current `phi`, `b`, settle target...) plus the short git SHA at capture time. |
| **Trajectory dataset** | `harness/baselines/<model>/` (e.g. `sin2phi/`) | `cd harness && npm run capture -- <scenario>` | Headless Playwright + CCapture.js run that records fiducial positions over time for a fixed scripted scenario. Used for model-vs-model regression. |

All four streams share a single concept: capture the state, don't paraphrase it.
A screenshot, a JSONL line, and a sidecar JSON are all cheaper than a round-trip
to the user.

---

## When to reach for each

### Telemetry (`?telemetry=1`, tail `/tmp/pageturn-telemetry.jsonl`)

- **Did event X actually fire?** -- "the pointer-up handler is supposed to
  start a settle but the page just stops; is `settle_start` in the log?"
- **Multi-step interaction correlation** -- "the second fan turn after a
  cancel has wrong direction; let me diff the events emitted on the first
  vs second attempt."
- **Timing** -- the log timestamps each event in ms since page load, so you
  can see if frame N and frame N+1 are 200ms apart (a hitch).
- **Cheap**: one shell pipeline (`tail -f ... | jq -c`) gives a real-time view.

### Debug HUD (`?debug=1`)

- **What was the value at the moment the screenshot was taken?** -- the HUD
  is *in* the screenshot, so when the user posts an image you can read off
  `dihedral=1.42, originY=0.31` without asking.
- **Sanity-check during dev** -- glance at the HUD while dragging to confirm
  the state machine is in the phase you expect.
- The HUD is text rendered into the DOM, not the WebGL canvas, so it survives
  any rendering pathology (a black canvas still has a readable HUD).

### Long-press capture (`?capture=1`)

- **"Rewind to this exact state"** -- the sidecar JSON has every uniform and
  state-machine field, so a regression test or harness scenario can be
  reconstructed deterministically. The sidecar also records the short git SHA
  so you know exactly which build produced the frame.
- **A specific moment that the user can identify** -- "right when the page
  flips past vertical" is a long-press away; no recording, no scrubbing.
- The capture path uses `preserveDrawingBuffer` (PR #17) and registers in the
  capture phase before `main.ts`'s pointer handlers (PR #16), so it does not
  interfere with the in-flight gesture.

### Trajectory dataset (`harness/baselines/sin2phi/`)

- **Comparing models** -- "does the new developable-surface shader produce
  the same fiducial trajectory as the `sin2phi` baseline for scenario
  `slow-diagonal-drag`?"
- **Regression catch** -- a model change that should be visually invisible
  should produce a near-identical trajectory; large diffs flag unintended
  side effects.
- **Heavy** (Docker / Playwright) -- only reach for this when comparing
  shader outputs across commits, not for one-off bug hunts.

---

## Concrete agent recipe: investigating a UX bug

You have a vague report ("the page tears at the corner mid-flick"). Resist
the urge to ask the user for more detail. Instead:

### 1. Start the dev server with every stream on

```bash
npm run dev
# then open in a browser:
# http://localhost:5173/?debug=1&fiducials=1&telemetry=1&capture=1&session=corner-tear
```

Flags:
- `debug=1` -- HUD overlay
- `fiducials=1` -- dot grid painted on the page texture (makes
  inextensibility violations and curl-axis errors visible)
- `telemetry=1` -- writes to `/tmp/pageturn-telemetry.jsonl`
- `capture=1&session=corner-tear` -- enables long-press; screenshots will be
  named `corner-tear-<n>.png` in `contrib/screenshots/`

### 2. Stream telemetry in a Monitor

```bash
tail -f /tmp/pageturn-telemetry.jsonl | jq -c
```

Run this with the Monitor tool (or `run_in_background`) so you get notified
on every new event line. When the user reports the bug, you already have the
event sequence.

### 3. Reproduce the bug; long-press at key states

Either reproduce yourself (most bugs in this prototype are deterministic and
reproducible from the URL params) or, if it's a true input-pattern bug, ask
the user *only* "please reproduce and long-press the canvas at the moment it
looks wrong, and once just before". Two captures, no narration required.

### 4. Read the captured artefacts

```bash
ls -la contrib/screenshots/corner-tear-*
```

For each capture:
- View the PNG -- the fiducial grid + HUD tell you *what the shader was
  doing geometrically*.
- Read the `.json` sidecar -- exact `dihedral`, `originY`, `dragProgress`,
  settle target, git SHA at capture time. Correlate sidecar timestamps with
  the telemetry log to see what events were in flight.

### 5. Form a hypothesis, lock it in with a test

- A unit test in `src/**/*.test.ts` if the bug is in the state machine.
- A harness scenario in `harness/scenarios/` if the bug is visible only
  through rendering.

Make the test fail first, fix the underlying code, watch the test pass. Run
the trajectory-dataset capture if the change touches the shader so you can
diff fiducial paths against the `sin2phi` baseline.

---

## What NOT to do

- **Don't ask the user for state values.** "What was the dihedral?" -- read
  the sidecar JSON. "What spread were you on?" -- read the HUD in the
  screenshot.
- **Don't ask the user to describe what they see.** Ask them to long-press
  and send the PNG. The image is the description.
- **Don't ask which build they're on.** The sidecar JSON has the short git
  SHA captured at long-press time.
- **Don't run the full Docker harness for a one-off bug.** Use the dev
  server + telemetry + long-press first. Save the harness for cross-model
  regression.
- **Don't paraphrase the telemetry stream.** When citing what happened, copy
  the actual event lines from `/tmp/pageturn-telemetry.jsonl` so the user
  can grep/cross-reference.
- **Don't disable a stream because it's noisy.** The streams are cheap and
  independent; the cost of forgetting to re-enable one is asking a question
  you didn't have to ask.

---

## Cross-references

- **PRD #9** -- `docs/prd-settle-physics.md` -- aerodynamic settle model.
  When debugging settle behavior, the trajectory dataset is your friend.
- **PRD #11** -- `docs/prd-page-model.md` -- developable-surface page model.
  Inextensibility violations are easiest to see with `?fiducials=1`.
- **Test audit** -- sibling document by the test-audit agent (lands
  alongside this one); covers which Vitest suites are trustworthy and
  which (popup-spread) are pre-existing failing.
- **Open issues** -- #18 (inextensibility), #19 (aerodynamic settle), #20
  (popup tests failing on main), #21 (`createPopup` unused warning) -- all
  of these are debuggable with the workflow above.
- **Capture pipeline PRs** -- #16 (long-press capture-phase fix), #17
  (`preserveDrawingBuffer` for canvas screenshots) -- the foundations the
  long-press stream relies on.
