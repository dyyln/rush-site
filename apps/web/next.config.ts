import path from "node:path";
import type { NextConfig } from "next";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || `${apiUrl.replace(/^http/, "ws")}/ws`;
const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};
const dev = process.env.NODE_ENV !== "production";

// Next inlines its bootstrap scripts, so scripts need unsafe-inline without a nonce
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.steamstatic.com https://steamcdn-a.akamaihd.net https://images.steamusercontent.com",
  `connect-src 'self' ${origin(apiUrl)} ${origin(wsUrl)}${dev ? " ws: http://localhost:*" : ""}`,
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${origin(apiUrl)}`,
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
