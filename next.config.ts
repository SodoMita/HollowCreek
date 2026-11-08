import type { NextConfig } from "next";

const staticCache = "public, max-age=300, stale-while-revalidate=86400";
const artCache = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  async headers() {
    // The standalone client and its SVG art never change between deploys.
    // Caching them removes ~1 MB of revalidation traffic on every room load;
    // HTML keeps a short lifetime so a redeploy is picked up within minutes.
    return [
      { source: "/art/:path*", headers: [{ key: "Cache-Control", value: artCache }] },
      { source: "/play/:path*", headers: [{ key: "Cache-Control", value: staticCache }] },
    ];
  },
  async redirects() {
    return [
      { source: "/play", destination: "/play/index.html", permanent: false },
      // Old room links (and the React room) now open the standalone client.
      { source: "/room/:code", destination: "/play/?room=:code", permanent: false },
    ];
  },
};

export default nextConfig;
