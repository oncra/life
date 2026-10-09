import type { NextConfig } from "next";

// The build guide for a Life Node lives at /node; it was /lifebox until 2026-10-09, and those links stay valid.
// lifebox.oncra.org serves the guide at the root of that host. Single-segment paths only, so /api, /_next and files pass through.
const lifeboxHost = process.env.LIFEBOX_HOST || "lifebox.oncra.org";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/lifebox", destination: "/node", permanent: true },
      { source: "/lifebox/:path*", destination: "/node/:path*", permanent: true },
    ];
  },
  async rewrites() {
    return {
      // Order matters: beforeFiles keeps matching after a rewrite, so the root rule comes last
      // (otherwise "/" becomes "/node" and then "/node/node").
      beforeFiles: [
        { source: "/:step([a-z0-9-]+)", has: [{ type: "host", value: lifeboxHost }], destination: "/node/:step" },
        { source: "/", has: [{ type: "host", value: lifeboxHost }], destination: "/node" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
