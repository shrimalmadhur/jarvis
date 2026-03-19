import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": ["./data/**", "./.claude/**"],
  },
};

export default nextConfig;
