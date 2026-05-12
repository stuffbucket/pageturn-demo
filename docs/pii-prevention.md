# Path-PII prevention strategy

PR [#42](https://github.com/stuffbucket/pageturn-demo/pull/42) introduced a
scrub *report* — a forensic sweep that cleaned leaked absolute paths and
agent-worktree paths from existing PRs and issue comments. That's after-the-
fact. This doc covers **prevention** going forward.

The leaks scrubbed in #42 came almost exclusively from agent-authored PR
bodies and comments where `worktreePath` / `abs_project_path` strings ended up
embedded in JSON samples. So the strategy is tailored to agent-driven flow,
not human credential leakage.

## Patterns of concern

Not secrets. Path-shaped PII:

| Category | Regex (extended) |
|---|---|
| `abs_users_path` | `/Users/[A-Za-z0-9._-]+/` |
| `abs_home_path` | `/home/[A-Za-z0-9._-]+/` |
| `agent_worktree` | `\.claude/worktrees/agent-[a-f0-9]+` |
| `project_memory` | `~?/\.claude/projects/-Users-[A-Za-z0-9._-]+` |
| `win_users_path` | `[Cc]:\\Users\\[A-Za-z0-9._-]+` |

Secrets (tokens, PEM blocks) were verified absent in #42 and are out of scope
here — if that changes, add a layer with `gitleaks` or `trufflehog`.

## Layers, ranked by ROI

1. **GitHub Action on PR/comment events** *(shipped)* — catches PII in
   bodies and comments regardless of how they got there (web UI, API, agent).
   Posts a single idempotent nudge comment naming the offenders. Non-blocking
   — it's a visibility layer.
   - File: `.github/workflows/scan-pr-pii.yml` + `scripts/scan-path-pii.sh`
2. **Local pre-push git hook** *(shipped, opt-in)* — scans commits-to-be-
   pushed (messages + added lines) for the same patterns. Warns by default;
   set `PII_HOOK_STRICT=1` to make it blocking.
   - Install: `bash scripts/install-pii-hook.sh`
   - Remove: `bash scripts/install-pii-hook.sh --remove`
3. **`pr-monitor` skill update** *(already done in a sibling change)* — the
   agent skill includes a "Scrubbing PR content" section; agents are expected
   to run the same regex check before `gh pr create`. Layer 1 catches misses.
4. **`gh pr create` wrapper script** *(deferred)* — would prevent
   publication entirely for users who opt in. Low ROI given the GH Action
   already catches and nudges within seconds.
5. **`gitleaks` / `trufflehog` / `secretlint`** *(deferred)* — credscan tools
   are great for secrets but overkill for narrow path patterns. Would add a
   binary dep + license entry to chase a problem we don't yet have.

## Why advisory, not blocking?

The Action posts a comment instead of failing the check because:

- The scrub report shows the leaks are small JSON-sample blocks, not credential
  exfiltration — friction should match impact.
- A failing check on every PR edit train would block merges for cosmetic
  reasons.
- Agents already self-scrub; this is the safety net.

If false-negative rate drops to zero and the team wants enforcement, flip the
last `exit 0` in `scripts/scan-path-pii.sh` to `exit 1` (or branch on
`STRICT=1` similar to the pre-push hook).

## Verifying the action

To smoke-test: edit a PR description on a draft branch with a fake
`/Users/<name>/foo/` string. Within ~30s the Action runs and posts (or
updates) the marked `<!-- path-pii-bot:v1 -->` comment. Remove the leak and
edit again; the comment will be updated to reflect the empty result on next
non-empty hit, but stale nudges are kept on the thread for audit — close them
manually if desired.

## Cross-references

- `~/.claude/skills/pr-monitor/SKILL.md` — "Scrubbing PR content" section
- `docs/pr-pii-scrub-2026-05-12.md` — original scrub report (lands with #42)
