import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  async redirects() {
    return [
      // The Storage Explorer became the Backups page. Links, bookmarks and notifications that
      // still point at the old address arrive there, with their filters.
      { source: "/dashboard/storage", destination: "/dashboard/backups", permanent: true },
      { source: "/dashboard/storage/:path*", destination: "/dashboard/backups/:path*", permanent: true },
      // The pages of sources, destinations and channels became the tabs of Connections. Here and not
      // as pages, since a page read the names of the tabs from a client module, where the server
      // only sees a reference, and sent every bookmark to the first tab.
      { source: "/dashboard/sources", destination: "/dashboard/connections?tab=databases", permanent: true },
      { source: "/dashboard/destinations", destination: "/dashboard/connections?tab=destinations", permanent: true },
      { source: "/dashboard/notifications", destination: "/dashboard/connections?tab=notifications", permanent: true },
    ];
  },
};

export default nextConfig;
