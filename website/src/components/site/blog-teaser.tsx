import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export function BlogTeaser() {
  const posts = getAllPosts().slice(0, 2);
  if (posts.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">From the blog</h2>
        <Link
          href="/blog"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          View all posts &rarr;
        </Link>
      </div>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group rounded-xl border border-border p-6 transition-colors hover:border-primary/50"
          >
            <p className="text-sm text-muted-foreground">
              {new Date(post.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            <h3 className="mt-2 text-lg font-semibold transition-colors group-hover:text-primary">
              {post.title}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">{post.excerpt}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
