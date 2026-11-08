import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/play", destination: "/play/index.html", permanent: false },
      // Old room links (and the React room) now open the standalone client.
      { source: "/room/:code", destination: "/play/?room=:code", permanent: false },
    ];
  },
};

export default nextConfig;
