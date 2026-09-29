import type { NextConfig } from "next";

// lifebox.oncra.org serves the build plan at the root of that host; the same pages are
// /lifebox/... on the main host. Single-segment paths only, so /api, /_next and files pass through.
const lifeboxHost = process.env.LIFEBOX_HOST || "lifebox.oncra.org";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", has: [{ type: "host", value: lifeboxHost }], destination: "/lifebox" },
        { source: "/:step([a-z0-9-]+)", has: [{ type: "host", value: lifeboxHost }], destination: "/lifebox/:step" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
