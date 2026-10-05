import type { NextConfig } from "next";

/**
 * Security headers are applied to every response.
 *
 * NOTE: we deliberately do NOT set `X-Frame-Options: DENY` or a restrictive
 * `frame-ancestors` CSP directive, because the platform must be embeddable in
 * the hosted preview shell. Production deployments that do not require
 * embedding should set `frame-ancestors 'none'` (see docs/SECURITY.md).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Keep server actions payloads small & predictable.
    serverActions: { bodySizeLimit: "4mb" },
  },
  // Dev-time origin allow-list for the hosted preview proxy.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "localhost", "127.0.0.1"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
