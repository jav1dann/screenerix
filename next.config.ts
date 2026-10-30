import type { NextConfig } from "next";

/**
 * Security headers on every response: no framing (clickjacking on sign-in / billing), no MIME
 * sniffing, no full URLs in Referer, no camera / mic / location, and HSTS in production. The CSP
 * only covers framing, plugins and <base>: scripts keep Next's defaults.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  allowedDevOrigins: ["26.186.104.187"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;