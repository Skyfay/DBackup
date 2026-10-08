import { ImageResponse } from "next/og";
import { getAllSlugs, getPostBySlug } from "@/lib/blog";

// The card of a post without an illustration, at a fixed .png path, so the
// host sends it as an image. Rendered once per post during the static export.
export const dynamic = "force-static";
export const dynamicParams = false;

const size = { width: 1200, height: 630 };

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0b0e14",
          color: "#f5f6f8",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: 28,
            fontWeight: 700,
            color: "#4f7fff",
          }}
        >
          DBackup Blog
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 1000,
          }}
        >
          {post.title}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 26,
            color: "#9aa1ad",
          }}
        >
          {new Date(post.date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · {post.author}
        </div>
      </div>
    ),
    { ...size }
  );
}
