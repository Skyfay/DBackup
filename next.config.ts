import type { NextConfig } from "next";

/**
 * The hosts `next dev` hands its hot reload and other dev resources to, besides localhost. A dev
 * server opened from another machine, like a dev box reached over a VPN, refuses them otherwise.
 * Taken from the addresses the app is opened at anyway, so `.env` stays the one place to set
 * them. Production never reads it.
 */
function devOrigins(): string[] {
  const urls = [process.env.BETTER_AUTH_URL, ...(process.env.TRUSTED_ORIGINS?.split(",") ?? [])];
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url?.trim()) continue;
    try {
      hosts.add(new URL(url.trim()).hostname);
    } catch {
      // Not a URL, so there is no host to allow.
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: devOrigins(),
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
