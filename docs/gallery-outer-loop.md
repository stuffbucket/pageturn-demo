# Outer-loop tooling visual gallery

Companion to the inner-loop gallery. Where "inner-loop" tools serve the
single-developer feedback cycle (HUD, telemetry, captures), **outer-loop**
tools wrap the dev loop — they are the CI checks, harness scenarios,
review artifacts, and governance docs that catch regressions across
agents and across time.

All image and text artifacts referenced below are pinned to commit
[`c3e17d3`](https://github.com/stuffbucket/pageturn-demo/commit/c3e17d36b8483b248744434538bb758bdda7d10c)
so the doc renders the same way after the branch is deleted.

---

## 1. Playwright harness — assertion mode

![harness assertion output](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/01-harness-output.txt)

```
▶ spine-pin-diagonal  (1500ms @ 30fps)
  · [page:log] [harness:trajectories] "spine-pin-diagonal" fps=30 duration=1500ms
  · [page:log] [harness:trajectories] sampled 1505 fiducial points across 35 markers
  · scenario ran in 2494ms (trajectory mode)
  ✓ trajectory: Spine-adjacent fiducial (u=0.1, v=0.5) world-space |x| stays
                bounded by the page-local origX (=0.1) ...
      abs-max(P_0_3.x) = 0.1000 vs threshold 0.105 (pass)
  ✗ pixel-min-luma: Spine column at peak dihedral must be page-cream pixels ...
      mean luma=47.51 (threshold>=90, region=1368px @ 313,144 -> 332,216)

Assertion summary: 0/1 scenarios passed.
```

Scenarios live in `harness/scenarios/*.json` and are driven by
`harness/runner/run.ts` (Playwright + MediaRecorder). Each scenario
declares an `assertions[]` array of types `telemetry-event`,
`file-exists-glob`, `pixel-min-luma`, `pixel-max-variance`,
`pixel-edge-transitions`, or `trajectory`. The runner exits non-zero on
the first failure, so this is the regression-test pathway: invariants
about spine-pinning, capture pipeline behaviour, and shader-boundary
sharpness are encoded as scenario JSON and re-checked on every push.
Raw output is preserved at
[`contrib/debug/gallery/outer-loop/01-harness-output.txt`](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/01-harness-output.txt).

---

## 2. Trajectory dataset

![trajectory baseline chart](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/02-trajectory-baseline.png)

```json
{
  "scenario": "horizontal-pull",
  "viewport": { "width": 640, "height": 360 },
  "fiducial": "P_0_0",
  "samples_first_5": [
    [303.10, 0.10000, -0.42620, 0.40509],
    [434.30, 0.07932, -0.38425, 0.44923],
    [514.40, 0.05013, -0.36659, 0.46781],
    [526.30, 0.04238, -0.36380, 0.47074],
    [538.40, 0.03841, -0.36260, 0.47201]
  ]
}
```

Baselines under `harness/baselines/sin2phi/` (and `developable/` from the
inextensibility PRD) record world-space `[t, x, y, z]` samples for the 35
fiducial dots painted onto each page surface in `?fiducials=1` mode. The
runner's trajectory mode re-derives the same samples by reimplementing
the inline `FLIP_VERT` shader in JS (see
`harness/src/bootstrap.ts → fiducialWorldPosition`), then `trajectory`
assertions compare per-fiducial axis statistics against bounded
thresholds. The dataset doubles as a regression substrate for the
developable-surface model (PRD `docs/prd-page-model.md`, PR #40), which
must reproduce the sin(2φ) baseline trajectories within a tolerance
envelope before it can replace the existing shader.

---

## 3. Stryker mutation testing

```
File              | % Mutation score | # killed | # timeout | # survived | # no cov
                  |  total | covered |          |           |            |
------------------+--------+---------+----------+-----------+------------+----------
All files         |  67.96 |   75.36 |      253 |        10 |         86 |       38
 BookState.ts     |  67.92 |   77.59 |      174 |         6 |         52 |       33
 CreaseGeometry.ts|  63.64 |   65.88 |       53 |         3 |         29 |        3
 PageGeometry.ts  |  79.41 |   84.38 |       26 |         1 |          5 |        2

448 mutants total: 253 killed | 10 timed out | 86 survived | 38 no-coverage | 61 TS-rejected
Total mutation score: 67.96%   Covered-code score: 75.36%
```

`npm run test:mutation` runs StrykerJS over the three pure-math modules
in `src/book/` (`BookState`, `CreaseGeometry`, `PageGeometry`) using the
Vitest test runner and the TypeScript checker as a guard. The HTML
report lands in `reports/mutation/mutation.html` (gitignored); the
clear-text summary is preserved at
[`03-mutation-summary.txt`](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/03-mutation-summary.txt).
Policy lives in `docs/mutation-testing-policy.md`; the latest interpretive
report (top-10 surviving mutants with recommendations) is in
`docs/mutation-test-report-2026-05-12.md`. `Book.ts` is currently
excluded — ADR-0001's reactivation checklist names this re-inclusion as
a follow-up.

---

## 4. PII prevention GitHub Action

![path-PII bot nudge comment preview](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/04-pii-bot-comment.png)

`.github/workflows/scan-pr-pii.yml` runs `scripts/scan-path-pii.sh` on
every `pull_request`, `pull_request_review_comment`, and `issue_comment`
event. It regex-scans the PR/comment body for absolute filesystem paths
(`/Users/<u>/`, `/home/<u>/`, `C:\Users\<u>\`), agent worktree paths
(`.claude/worktrees/agent-<hex>`), and project-memory paths, then posts
(or idempotently updates) a single advisory nudge comment marked
`<!-- path-pii-bot:v1 -->`. The check is advisory only — it doesn't fail
the build — but combined with the pre-push hook from
`docs/pii-prevention.md` it prevents agent-authored PR bodies from
leaking host-machine paths. The screenshot above is a faithful preview
rendered through GitHub's own `/markdown` endpoint (the bot has not
fired in the wild yet, because the layered pre-push hook intercepts
violations before they reach the remote).

---

## 5. Long-press capture — EXIF + sidecar

```
Image Description : j=-1,phi=0,dihedral=0,sessionId=harness
Make              : pageturn-demo
Camera Model Name : a261529                          ← git commit short SHA
Software          : pageturn-screenshot-server
User Comment      : {"drag":{...},"crease":{...},"turn":{...},
                     "camera":{...},"fps":60,
                     "build":{"commit":"a2615298388930d2373d6cf010402c586eb176b2",
                              "branch":"docs/outer-loop-gallery","dirty":false,
                              "worktreePath":"<redacted>",
                              "repoSlug":"stuffbucket/pageturn-demo",
                              "goal":"Capture outer-loop tool visual gallery"}}
```

A 5-second motionless press in `?capture=1` mode triggers
`src/long-press-capture.ts`, which POSTs the canvas to the Vite
`screenshot-server` plugin. The server writes a PNG with a W3C `eXIf`
chunk carrying the full HUD state JSON in `UserComment` and the git
commit short SHA in `Camera Model Name`, plus a `.json` sidecar that
adds `git_commit`, `git_branch`, `git_dirty`, and the build info object.
The point is **archival**: any future agent receiving the PNG alone can
recover the exact tree state (`git checkout <Camera Model Name>`) and
the runtime HUD that produced it. Full sanitized output at
[`05-exif-output.txt`](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/05-exif-output.txt)
and
[`05-sidecar.json`](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/05-sidecar.json).

---

## 6. Starlight docs site

![docs-site home page](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/06-docs-site-home.png)

![architecture overview page](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/06-docs-site-architecture.png)

`docs-site/` is an Astro + Starlight site that compiles to static HTML
and is published to <https://stuffbucket.github.io/pageturn-demo/> by
`.github/workflows/deploy-docs.yml`. It holds the long-form architecture
narrative, shader walk-throughs, URL-flag matrix, and quickstart guides
that would otherwise crowd `CLAUDE.md`. CLAUDE.md deliberately stays
terse and points here for prose. The sidebar nav (visible left) is the
contract: each top-level section corresponds to a directory under
`docs-site/src/content/docs/`.

---

## 7. ADR + PRD docs

```markdown
# ADR-0001: Popup feature temporarily disabled; tests skipped

Status: Accepted (2026-05-12)

## Context
... the call site was commented out:
    // src/book/Book.ts:191
    // this.createPopup();
... The 10 skipped tests in `Book.test.ts` are intentional, not failing.

## Decision

Disable the popup feature in source. Skip the popup tests with
`describe.skip(...)`. Annotate `createPopup` with `@ts-expect-error`.

## Reactivation checklist

- [ ] Re-enable `this.createPopup()` call site in `src/book/Book.ts`.
- [ ] Remove `@ts-expect-error` annotation.
- [ ] Flip `describe.skip` → `describe` in Book.test.ts (10 tests).
- [ ] Add `src/book/Book.ts` back to the Stryker mutate list.
- [ ] Document any behavioural delta in a new ADR.
```

```markdown
# PRD: Page model — inextensibility (developable surface)

The inline FLIP_VERT shader rotates each flap vertex by an angle that
depends on its own t-coordinate:
    φ(t) = uAngle + 0.4 · t · sin(2 · uAngle)
This is a non-rigid, per-vertex rotation — geodesic distances along the
page surface are NOT preserved. ... Paper has near-zero membrane strain.

Functional Requirements
  FR-1  Page surface is a developable strip throughout every turn.
  FR-2  Geodesic length along any rulings line is preserved within ±0.5%.
  ...
```

ADRs (Michael-Nygard style) and PRDs live under `docs/`. ADRs record
*decisions* — what we did, why, and the checklist to reverse it. PRDs
record *intended* behavior with Functional Requirements, math sketches,
and Open Questions, and are linked to GitHub issues via the
`tracked-by-prd-N` label (see §8). The two active PRDs are
`docs/prd-page-model.md` (inextensibility / developable surface, issue
#18 / PR #40) and `docs/prd-settle-physics.md` (aerodynamic settle,
issue #19).

---

## 8. Issue tracker with triage labels

![GitHub issues filtered by tracked-by-prd labels](https://raw.githubusercontent.com/stuffbucket/pageturn-demo/c3e17d36b8483b248744434538bb758bdda7d10c/contrib/debug/gallery/outer-loop/08-issue-tracker.png)

```
   #  state    labels                            title
  --  -------  --------------------------------  -----------------------------------------
  18  CLOSED   bug,model,tracked-by-prd-11       Inextensibility violation: page stretches
  19  OPEN     model,tracked-by-prd-9,feature    Aerodynamic settle not implemented
  20  CLOSED   tech-debt,tests                   Popup spread tests failing on main
  29  OPEN     bug,model,tracked-by-prd-9        Release reverts to edge-bend model
  31  CLOSED   bug,model                         Back face of turning page bleeds through
  32  CLOSED   bug,model                         Ragged tessellation at spine boundary
```

Issues are the unit of work; `tracked-by-prd-N` labels link them back to
the PRD that specifies the desired behaviour. Open work as of this
gallery's commit: #19 (aerodynamic settle, PRD `docs/prd-settle-physics.md`)
and #29 (release reverts to edge-bend model, same PRD). The label
convention lets an agent answer "is this fixed?" by cross-referencing
PRD Functional Requirements with the closing PR — not by reading the
issue thread.

---

## Artifact index

| # | Artifact | Path |
|---|---|---|
| 1 | Harness assertion output | `contrib/debug/gallery/outer-loop/01-harness-output.txt` |
| 2 | Trajectory chart + sample | `02-trajectory-baseline.png`, `02-trajectory-sample.json` |
| 3 | Mutation summary | `03-mutation-summary.txt` |
| 4 | PII bot nudge preview | `04-pii-bot-comment.png` |
| 5 | EXIF + sidecar | `05-exif-output.txt`, `05-sidecar.json` |
| 6 | Docs site home + architecture | `06-docs-site-home.png`, `06-docs-site-architecture.png` |
| 7 | ADR + PRD samples | inline above |
| 8 | Issue tracker view | `08-issue-tracker.png`, `08-issue-tracker.txt` |
