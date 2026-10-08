import { ImageResponse } from "next/og";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { createTranslator, stripTags } from "@/i18n/translate";
import { getAdapterIcon, needsDarkModeBoost } from "@/lib/adapter-icons";
import { getPostBySlug } from "@/lib/blog";
import { DATABASE_COLORS, DATABASE_PAGES, isDatabaseSlug } from "@/lib/integrations";
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

/** The card of a database page, with the logo and the headline of the page in its language. */
export function databaseOgImage(locale: Locale, slug: string) {
  if (!isDatabaseSlug(slug)) throw new Error(`No database page ${slug}`);
  const t = createTranslator(locale);
  const adapter = DATABASE_PAGES[slug].adapter;
  const icon = getAdapterIcon(adapter);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? 24} ${icon.height ?? 24}">${icon.body}</svg>`;
  const logo = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

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
        <div style={{ display: "flex", alignItems: "center", gap: "20px", fontSize: 30, fontWeight: 700 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 18,
              // Logos with dark fills sit on a light tile, where they stay readable.
              background: needsDarkModeBoost(adapter) ? "#f4f4f5" : "#1a1d26",
              boxShadow: `0 0 60px ${DATABASE_COLORS[adapter]}`,
            }}
          >
            {/* The card is drawn by ImageResponse, which only knows a plain img. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} width={44} height={44} alt="" />
          </div>
          {t("integrations.page.eyebrow")}
        </div>
        <div style={{ display: "flex", marginTop: 44, fontSize: 56, fontWeight: 700, lineHeight: 1.15, maxWidth: 1000 }}>
          {stripTags(t(`integrations.db.${slug}.heroTitle`)).replace(/-/g, "\u2011")}
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 26, color: "#9aa1ad" }}>DBackup · {t("meta.tagline")}</div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
