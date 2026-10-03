import { Bell } from "lucide-react";
import { BlogIndex } from "@/components/site/blog/blog-index";
import { PageBackdrop } from "@/components/site/blog/page-backdrop";
import { Eyebrow, Glow } from "@/components/site/fx";
import { getAllPosts } from "@/lib/blog";
import { formatDate } from "@/lib/utils";
import { CHANGELOG_URL, GITHUB_URL } from "@/lib/content";

export const metadata = {
  title: "Blog",
  description:
    "Design decisions, trade-offs and guides from the people who build DBackup.",
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": "/blog/rss.xml" },
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const dates = Object.fromEntries(posts.map((p) => [p.slug, formatDate(p.date)]));

  return (
    <div className="relative">
      <PageBackdrop />

      <div className="relative mx-auto max-w-[1148px] px-6 pt-[140px] sm:pt-[172px]">
        <div className="flex flex-col gap-5">
          <Eyebrow>Blog</Eyebrow>
          <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-[64px]">
            Notes from <span className="fx-shine">building DBackup.</span>
          </h1>
          <p className="max-w-[560px] text-lg leading-relaxed text-muted-foreground">
            Design decisions, trade-offs and guides, written by the people who make it.
          </p>
        </div>

        <BlogIndex posts={posts} dates={dates} />

        <section className="panel relative mt-[72px] flex flex-wrap items-center gap-5 overflow-hidden rounded-[20px] px-8 py-7">
          <Glow color="#34d399" opacity={0.12} blur={70} className="-top-20 -right-16 h-60 w-[300px]" />
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-tone-green/14 text-tone-green">
            <Bell className="size-5" />
          </span>
          <div className="relative min-w-[240px] grow">
            <h2 className="text-base font-semibold">Never miss a release</h2>
            <p className="text-muted-foreground">
              Watch the repository on GitHub or follow the changelog. New posts land in the RSS feed.
            </p>
          </div>
          <div className="relative flex gap-2">
            <a
              href={CHANGELOG_URL}
              target="_blank"
              rel="noreferrer"
              className="flex h-[38px] items-center rounded-lg border border-input bg-secondary px-3.5 font-medium"
            >
              Changelog
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="fx-btn flex h-[38px] items-center rounded-lg bg-primary px-3.5 font-medium text-primary-foreground"
            >
              Watch on GitHub
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
