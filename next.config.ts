import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/play", destination: "/play/index.html", permanent: false }];
  },
};

export default nextConfig;
