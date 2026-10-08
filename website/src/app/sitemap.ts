import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/**
 * Every URL with the trailing slash its canonical has, so no entry is a
 * redirect. A page only carries a lastmod where a real date exists, since
 * Google ignores one that changes with every build.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1.0 },
    {
      url: `${SITE_URL}/blog/`,
      ...(posts[0] && { lastModified: new Date(posts[0].date) }),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    { url: `${SITE_URL}/roadmap/`, changeFrequency: "weekly", priority: 0.8 },
    ...posts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}/`,
      lastModified: new Date(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
