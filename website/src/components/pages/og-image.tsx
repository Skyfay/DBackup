import { ImageResponse } from "next/og";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { getPostBySlug } from "@/lib/blog";
import { OG_SIZE } from "@/lib/seo";

/** The social card of the site in a language, served at /og.png and /de/og.png. */
export function siteOgImage(locale: Locale) {
  const t = createTranslator(locale);
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
            gap: "20px",
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#4f7fff",
            }}
          />
          DBackup
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 52,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 950,
          }}
        >
          {t("meta.ogHeadline").replace(/-/g, "\u2011")}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 28,
            color: "#9aa1ad",
            maxWidth: 900,
          }}
        >
          {t("meta.tagline")}
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
}

/** The card of a post without an illustration, with its title in the language of the page. */
export function blogPostOgImage(locale: Locale, slug: string) {
  const t = createTranslator(locale);
  const post = getPostBySlug(slug, locale);

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
          {t("meta.blogOgLabel")}
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
          {new Date(post.date).toLocaleDateString(INTL_LOCALE[locale], {
            timeZone: "UTC",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · {post.author}
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
