import { execFileSync } from "node:child_process";

/**
 * Remove a git worktree and prune stale entries. Best-effort — silently
 * swallows errors (worktree may already be gone from disk).
 */
export function removeWorktree(worktreePath: string, repoPath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
      cwd: repoPath,
      stdio: "ignore",
    });
    execFileSync("git", ["worktree", "prune"], { cwd: repoPath, stdio: "ignore" });
  } catch {
    // Worktree may already be gone from disk
  }
}

/** Force-remove a worktree without pruning. Use with pruneWorktrees for batch operations. */
export function forceRemoveWorktree(worktreePath: string, repoPath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
      cwd: repoPath,
      stdio: "ignore",
    });
  } catch {
    // Worktree may already be gone from disk
  }
}

/** Prune stale worktree entries. Best-effort. */
export function pruneWorktrees(repoPath: string): void {
  try {
    execFileSync("git", ["worktree", "prune"], { cwd: repoPath, stdio: "ignore" });
  } catch {
    // Best-effort
  }
}
