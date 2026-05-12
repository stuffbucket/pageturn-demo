/**
 * Shape of the object exported as `buildInfo` from the virtual module
 * `virtual:build-info`. Captured server-side at Vite dev-server start by the
 * `build-info` plugin (vite.config.ts) and embedded into the bundle. Mirrored
 * (intentionally duplicated) in vite.config.ts so the plugin has no runtime
 * dependency on the src tree.
 *
 * Stable contract: a sibling HUD agent depends on these field names/types.
 */
export interface BuildInfo {
  /** Full 40-char SHA. */
  commit: string
  /** 7-char short SHA. */
  commitShort: string
  /**
   * ISO 8601 timestamp of the commit (`git log -1 --format=%cI`). May carry
   * a non-UTC offset (e.g., `2026-05-12T15:55:27-07:00`) — git emits the
   * committer's local timezone. For UTC, use `commitDateUtc`.
   */
  commitDate: string
  /**
   * Same instant as `commitDate`, but normalized to UTC ISO 8601 with a `Z`
   * suffix (e.g., `2026-05-12T22:55:27Z`). Prefer this for display and
   * cross-machine comparison.
   */
  commitDateUtc: string
  /**
   * Branch name. May be a long agent-worktree branch like
   * `worktree-agent-abc123`. `"HEAD"` indicates a detached checkout.
   */
  branch: string
  /** True if working tree has uncommitted changes (`git status --porcelain`). */
  dirty: boolean
  /** Absolute path of the worktree root (`git rev-parse --show-toplevel`). */
  worktreePath: string
  /**
   * Human label derived from worktreePath:
   * - `"main"`           if path doesn't sit inside `.claude/worktrees/`
   * - `"agent-<short>"`  if path matches `.claude/worktrees/agent-<id>/`
   *                      (short = first 8 chars of `<id>`)
   * - `"other"`          for any other `.claude/worktrees/<name>/` arrangement
   */
  worktreeLabel: string
  /**
   * Remote origin URL, normalized to `https://github.com/owner/repo`
   * (SSH `git@github.com:owner/repo.git` is converted; trailing `.git`
   * stripped). Empty string if no `origin` remote is configured.
   */
  remoteUrl: string
  /** Owner/repo extracted from remoteUrl, e.g. `stuffbucket/pageturn-demo`. */
  repoSlug: string
  /**
   * GitHub PR associated with the current branch (head match), or null.
   * Populated via `gh pr list`; degrades to null if `gh` is missing,
   * unauthenticated, or if no open PR matches.
   */
  pr: { number: number; title: string; url: string } | null
  /**
   * Server start time as a UTC ISO 8601 string (always `Z`-suffixed via
   * `new Date().toISOString()`). Useful for distinguishing instances when a
   * single dev server is reloaded but the SHA hasn't changed.
   */
  serverStartedAt: string
  /**
   * Short plain-English description of what this build is for. Resolved at
   * server-start in this precedence order; first non-empty wins:
   *
   *   1. Environment variable `PAGETURN_BUILD_GOAL`
   *      (e.g., `PAGETURN_BUILD_GOAL="bend-axis tilt tuning" npx vite`)
   *   2. File `.build-goal` at the repo root (contents trimmed). Gitignored.
   *   3. Title of the associated GitHub PR (from `BuildInfo.pr.title`).
   *   4. `null` if none of the above are set.
   */
  goal: string | null
}
