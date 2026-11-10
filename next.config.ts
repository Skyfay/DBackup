import type { NextConfig } from "next";
import { CONFIG_UPLOAD_MAX_BYTES } from "./src/lib/core/config-upload";

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

/**
 * How much of a body the middleware holds for itself before it hands the rest on cut off. Next.js
 * neither refuses nor marks such a body, so the upload routes count their bodies themselves
 * (`readFormWithin`). Set a megabyte above the largest upload, the 10 MB of a configuration
 * backup, so a body too large still reaches the route past its limit and is answered 413 there
 * rather than arriving broken.
 */
const PROXY_BODY_BYTES = CONFIG_UPLOAD_MAX_BYTES + 1024 * 1024;

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: devOrigins(),
  experimental: {
    proxyClientMaxBodySize: PROXY_BODY_BYTES,
  },
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
      // The page of the shared databases became the tab Shared with you of the Backups page. Not
      // permanent, since the address was never part of a release.
      { source: "/dashboard/shared", destination: "/dashboard/backups?tab=shared", permanent: false },
      // Recently deleted was a page of its own for a while and is a part of Settings again, of the
      // tenant settings with more than one tenant. Not permanent, since the page was never released.
      { source: "/dashboard/recently-deleted", destination: "/dashboard/settings?part=recently-deleted", permanent: false },
    ];
  },
};

export default nextConfig;
