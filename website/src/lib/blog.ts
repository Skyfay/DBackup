import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");
/** The illustration of a post, public/blog/<slug>.webp, and its social card, public/blog/<slug>.jpg. */
const IMAGE_DIR = path.join(process.cwd(), "public/blog");
const WORDS_PER_MINUTE = 220;

export type PostTone = "blue" | "green" | "violet" | "cyan" | "amber";

/** The artwork of a post card, set in the frontmatter under `cover`. */
export interface PostCover {
  /** Three letters on the tile in the corner. */
  badge: string;
  tone: PostTone;
  /** Two short terminal lines, the first one a command. */
  snippet: string;
  /** A folder of files for the large card of the newest post. */
  path?: string;
  files?: { kind: string; name: string; size: string }[];
  command?: string;
}

export interface PostFrontmatter {
  title: string;
  date: string;
  excerpt: string;
  tags: string[];
  author: string;
  cover?: PostCover;
}

export interface PostSummary extends PostFrontmatter {
  slug: string;
  readingMinutes: number;
  /** The path of its illustration, shown on its card and above it, or null without one. */
  image: string | null;
  /** The path of its social card, 1200 by 630, or null to draw one. */
  socialImage: string | null;
}

export interface Post extends PostSummary {
  content: string;
}

export interface Heading {
  id: string;
  text: string;
}

export function getAllSlugs(): string[] {
  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.replace(/\.mdx$/, ""));
}

export function getPostBySlug(slug: string): Post {
  const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), "utf8");
  const { data, content } = matter(raw);
  const words = content.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length;
  const has = (file: string) => fs.existsSync(path.join(IMAGE_DIR, file));
  return {
    slug,
    content,
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    image: has(`${slug}.webp`) ? `/blog/${slug}.webp` : null,
    socialImage: has(`${slug}.jpg`) ? `/blog/${slug}.jpg` : null,
    ...(data as PostFrontmatter),
  };
}

export function getAllPosts(): PostSummary[] {
  return getAllSlugs()
    .map((slug) => {
      const { content: _content, ...meta } = getPostBySlug(slug);
      return meta;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** The `##` headings of a post, outside code fences, for the table of contents. */
export function getHeadings(content: string): Heading[] {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => {
      const text = line.slice(3).replace(/[`*_]/g, "").trim();
      return { id: slugify(text), text };
    });
}

/** Splits a title at its dash or colon, so the second half can carry the shine. */
export function splitTitle(title: string): [string, string | null] {
  const dash = title.indexOf(" - ");
  if (dash > 0) return [title.slice(0, dash + 3), title.slice(dash + 3)];
  const colon = title.indexOf(": ");
  if (colon > 0) return [title.slice(0, colon + 2), title.slice(colon + 2)];
  return [title, null];
}
