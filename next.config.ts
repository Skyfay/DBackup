import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  async redirects() {
    // The Storage Explorer became the Backups page. Links, bookmarks and notifications that
    // still point at the old address arrive there, with their filters.
    return [
      { source: "/dashboard/storage", destination: "/dashboard/backups", permanent: true },
      { source: "/dashboard/storage/:path*", destination: "/dashboard/backups/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
