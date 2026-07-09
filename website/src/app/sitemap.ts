import type { MetadataRoute } from "next";
import { getAllSlugs } from "@/lib/blog";

const BASE_URL = "https://dbackup.app";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllSlugs().map((slug) => ({
    url: `${BASE_URL}/blog/${slug}`,
    lastModified: new Date(),
  }));

  return [
    { url: BASE_URL, lastModified: new Date() },
    { url: `${BASE_URL}/blog`, lastModified: new Date() },
    ...posts,
  ];
}
