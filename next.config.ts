import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/play", destination: "/play/index.html", permanent: false }];
  },
};

export default nextConfig;
