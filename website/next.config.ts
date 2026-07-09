import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  // Force the project root to this folder - otherwise Turbopack detects the
  // sibling root pnpm-lock.yaml and infers the monorepo root as the workspace
  // root, pulling in the main app's src/instrumentation.ts and src/middleware.ts.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
