import type { Metadata } from "next";
import { META_DESCRIPTION, SITE_TITLE } from "@/lib/content";

/** The size of every social card of the site. */
export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The metadata of a page: its title and description, the canonical URL and
 * its social cards. A page that sets its own Open Graph replaces the whole
 * object of the layout, so every page names everything. The card is the one
 * of the site at /og.png unless the page passes the path of its own. Cards are
 * served from a .png or .jpg path, so the host sends them as images.
 */
export function pageMetadata(
  path: string,
  {
    title,
    description,
    article,
    image = "/og.png",
  }: { title?: string; description?: string; article?: { publishedTime: string }; image?: string } = {}
): Metadata {
  const cardTitle = title ? `${title} | DBackup` : SITE_TITLE;
  const cardDescription = description ?? META_DESCRIPTION;
  const images = [{ url: image, ...OG_SIZE, alt: title ?? SITE_TITLE }];
  const base = { title: cardTitle, description: cardDescription, url: path, siteName: "DBackup", locale: "en_US", images };
  return {
    ...(title && { title }),
    ...(description && { description }),
    alternates: { canonical: path },
    openGraph: article ? { ...base, type: "article", publishedTime: article.publishedTime } : { ...base, type: "website" },
    twitter: { card: "summary_large_image", title: cardTitle, description: cardDescription, images },
  };
}
