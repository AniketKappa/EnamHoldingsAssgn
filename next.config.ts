import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Server-only libraries that read files or spawn workers at runtime stay unbundled.
  serverExternalPackages: ["unpdf", "pdf-lib", "web-push", "yahoo-finance2", "postgres"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
