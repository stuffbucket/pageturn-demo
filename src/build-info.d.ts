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
  /** ISO 8601 timestamp of the commit (`git log -1 --format=%cI`). */
  commitDate: string
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
   * Server start time (ISO). Useful for distinguishing instances when a
   * single dev server is reloaded but the SHA hasn't changed.
   */
  serverStartedAt: string
}
