export type VersionInfo = {
  /** Display label: tag, branch@sha, or sha */
  label: string;
  tag: string;
  branch: string;
  commit: string;
};

export function getVersion(): VersionInfo {
  const tag = process.env.GIT_TAG ?? "";
  const raw = process.env.GIT_BRANCH ?? "";
  const commit = process.env.GIT_COMMIT ?? "";

  // On detached HEAD (tag checkout), git returns "HEAD" as branch name
  const branch = raw === "HEAD" ? "" : raw;

  let label: string;
  if (tag) {
    label = tag;
  } else if (branch && commit) {
    label = `${branch}@${commit}`;
  } else if (branch) {
    label = branch;
  } else if (commit) {
    label = commit;
  } else {
    label = "dev";
  }

  return { label, tag, branch, commit };
}
