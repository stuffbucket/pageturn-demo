# PR/Issue PII Scrub Report — 2026-05-12

## Scope

Scanned every pull request and issue (open + closed) in
[`stuffbucket/pageturn-demo`](https://github.com/stuffbucket/pageturn-demo)
for accidentally-leaked filesystem paths and usernames from agent
worktrees. Redactions were applied in place by editing PR bodies, issue
bodies, issue-thread comments, and inline review comments via the
GitHub API.

## What counts as a leak

| Category | Pattern | Replacement |
| --- | --- | --- |
| `abs_project_path` | `/Users/<u>/github/<u>/pageturn-demo/...` | strip prefix, keep repo-relative tail |
| `abs_home_path` | `/Users/<u>/...` (non-project) | `~/...` |
| `home_claude_project` | `~/.claude/projects/-Users-<u>-...` | `<project-memory>` |
| `worktree_strip` | `.claude/worktrees/agent-<hex>/<file>` | strip worktree prefix |
| `worktree_placeholder` | bare `.claude/worktrees/agent-<hex>` | `<worktree>/` |
| `username_brian_path` | `brian` as a path segment (not as a person's name) | `XXXX` |
| `username_bstucker_path` | `bstucker` as a path segment | `XXXX` |

GitHub login `stuffbucket` (public identity), commit SHAs, branch
names, PR numbers, agent IDs in isolation, and the repo path
`stuffbucket/pageturn-demo` are **not** redacted.

## Totals

| Metric | Count |
| --- | --- |
| PRs scanned (open + closed) | 33 |
| Issues scanned (open + closed) | 8 |
| PR items edited | 2 |
| Issue items edited | 0 |
| Secrets/tokens flagged | 0 |

### Categories of leak

| Category | Hits |
| --- | --- |
| `abs_project_path` | 1 |
| `worktree_placeholder` | 2 |

No matches for `abs_home_path`, `abs_linux_home`, `home_claude_project`,
`worktree_strip`, `username_brian_path`, or `username_bstucker_path`.
No secret-token patterns (GitHub PAT, OpenAI, Anthropic, AWS, GCP,
Slack, PEM) matched anywhere.

## Items edited

- **PR #38 body** (`worktree_placeholder` x1) — `worktreePath` JSON
  field in the sample BuildInfo output contained
  `~/pageturn-demo/.claude/worktrees/agent-aaf4c4854ecb3cd9d`.
- **PR #39 issue comment `4435638557`** (`abs_project_path` x1,
  `worktree_placeholder` x1) — end-to-end validation report had
  `worktreePath` set to
  `/Users/<user>/github/<user>/pageturn-demo/.claude/worktrees/agent-ab31debbe766618d5`.

## Sample before/after

### Category: `abs_project_path` + `worktree_placeholder`

Before (PR #39 comment 4435638557, fragment):

```json
"worktreePath": "/Users/brian/github/bstucker/pageturn-demo/.claude/worktrees/agent-ab31debbe766618d5",
```

After:

```json
"worktreePath": "<worktree>/",
```

(The absolute project path was stripped, then the worktree segment
collapsed to the placeholder.)

### Category: `worktree_placeholder` (PR #38 body)

Before:

```json
"worktreePath": "~/pageturn-demo/.claude/worktrees/agent-aaf4c4854ecb3cd9d",
```

After:

```json
"worktreePath": "~/pageturn-demo/<worktree>/",
```

## Recommendations

Most of the leakage observed came from agent reports being pasted
verbatim into PR bodies and comments, with the JSON dumps from
`GET /__build-info` carrying full absolute `worktreePath` values into
GitHub. Two complementary mitigations:

1. **At the source**: the `build-info` Vite plugin should emit a
   redacted `worktreePath` (or omit it for non-main worktrees and only
   keep `worktreeLabel`). The full path is rarely useful to consumers
   of the JSON.

2. **At the surface**: the `pr-monitor` skill at
   `~/.claude/skills/pr-monitor/` is being updated by a sibling agent
   with the same scrubbing rules used here, so future PR-related
   agent output is filtered before it reaches the GitHub API.

3. **Periodic re-scan**: this script
   (`/tmp/pii-scrub/scrub.py` in the worktree of this branch) can be
   re-run cheaply against the repo; ~30s for 33 PRs + 8 issues. Keep
   it on hand and run it after large bursts of agent activity.

## Methodology notes

- Edits applied via `gh pr edit`, `gh issue edit`, and
  `PATCH /repos/{owner}/{repo}/{issues,pulls}/comments/{id}`.
- The scrubber refuses to edit any content where a secret-token regex
  matches; the surrounding item is flagged for human review rather
  than silently rewritten. No flagged items in this run.
- The rule ordering is significant: project-path strip runs before the
  generic home-dir rule, and worktree-strip runs before the bare
  placeholder rule, so that a full
  `/Users/x/github/x/pageturn-demo/.claude/worktrees/agent-y/src/foo.ts`
  collapses cleanly to `src/foo.ts` rather than partial residue.
