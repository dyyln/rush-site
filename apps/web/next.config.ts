import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Lets a second dev server (e.g. mock mode) run beside the first
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  agentRules: false,
  output: "standalone",
  // Trace from the repo root so workspace packages land in the standalone bundle
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.steamstatic.com" },
      { protocol: "https", hostname: "avatars.cloudflare.steamstatic.com" },
    ],
  },
};

export default config;
