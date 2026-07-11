import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { MDXRemote } from "next-mdx-remote/rsc";
import { notFound } from "next/navigation";
import rehypePrettyCode from "rehype-pretty-code";
import { CodeBlock } from "@/components/site/code-block";

// Tailwind Typography's `prose-pre` box is a fixed dark background regardless
// of the site's light/dark toggle, so the code theme must be fixed dark too -
// pairing a light-optimized theme with that box would make plain tokens
// (near-black text) unreadable in light mode.
const CODE_THEME = "github-dark-default";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getAllSlugs().includes(slug)) return {};
  const post = getPostBySlug(slug);
  return { title: post.title, description: post.excerpt };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getAllSlugs().includes(slug)) notFound();
  const post = getPostBySlug(slug);

  return (
    <article className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <p className="text-sm text-muted-foreground">
        {new Date(post.date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}{" "}
        · {post.author}
      </p>
      <h1 className="mt-2 text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl">
        {post.title}
      </h1>
      <div className="prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-code:text-primary prose-pre:rounded-xl prose-pre:border prose-pre:border-border mt-8 max-w-none">
        <MDXRemote
          source={post.content}
          options={{
            mdxOptions: {
              rehypePlugins: [
                [rehypePrettyCode, { theme: CODE_THEME, keepBackground: false }],
              ],
            },
          }}
          components={{ pre: CodeBlock }}
        />
      </div>
    </article>
  );
}
