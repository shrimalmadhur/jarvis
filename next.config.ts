import { execSync } from "child_process";
import type { NextConfig } from "next";

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

const gitTag = git("describe --tags --exact-match 2>/dev/null");
const gitBranch = git("rev-parse --abbrev-ref HEAD");
const gitCommit = git("rev-parse --short HEAD");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": ["./data/**", "./.claude/**"],
  },
  env: {
    GIT_TAG: gitTag,
    GIT_BRANCH: gitBranch,
    GIT_COMMIT: gitCommit,
  },
};

export default nextConfig;
