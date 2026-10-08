import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CONIC, Glow, SpinBorder } from "@/components/site/fx";
import { Logo } from "@/components/site/integrations/page-parts";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { getPostBySlug } from "@/lib/blog";
import { GITHUB_URL } from "@/lib/content";
import { DATABASE_COLORS, DATABASE_NAMES, DATABASE_PAGES, type DatabaseSlug } from "@/lib/integrations";

/** The post every database page points to, on the dump staying a dump. */
export const RELATED_POST = "why-no-vendor-lock-in-matters";

/** The end of a database page: the other databases, the post on the dump staying a dump and the call to start. */
export function PageEnd({ locale, slug }: { locale: Locale; slug: DatabaseSlug }) {
  const t = createTranslator(locale);
  const page = DATABASE_PAGES[slug];
  const name = DATABASE_NAMES[slug];
  const color = DATABASE_COLORS[page.adapter];
  const post = getPostBySlug(RELATED_POST, locale);

  return (
    <>
    <section className="relative z-[2] mx-auto grid max-w-[1248px] gap-6 px-6 pt-28 lg:grid-cols-2">
      <div className="flex flex-col gap-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("integrations.page.otherDatabases")}</h2>
          <Link href={localePath(locale, "/integrations/")} className="text-[13px] font-medium text-tone-blue-soft">
            {t("integrations.page.allIntegrations")}
          </Link>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {page.related.map((other) => {
            const adapter = DATABASE_PAGES[other].adapter;
            return (
              <Link
                key={other}
                href={localePath(locale, `/integrations/${other}/`)}
                className="group panel flex items-center gap-3 rounded-[14px] p-3.5 transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted">
                  <Logo adapter={adapter} className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{DATABASE_NAMES[other]}</span>
                  <span className="truncate text-xs text-faint">{t(`integrations.cards.${adapter}.versions`)}</span>
                </span>
                <ArrowRight className="ml-auto size-4 shrink-0 text-faint transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("integrations.page.fromBlog")}</h2>
        <Link
          href={localePath(locale, `/blog/${RELATED_POST}/`)}
          className="group panel relative flex grow flex-col gap-2.5 overflow-hidden rounded-[18px] p-[22px] transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input"
        >
          <Glow color="#34d399" opacity={0.16} blur={55} className="-top-[60px] -right-10 h-[170px] w-[220px]" />
          <span lang={post.lang} className="relative text-[19px] leading-tight font-semibold tracking-[-0.02em]">
            {post.title}
          </span>
          <span lang={post.lang} className="relative leading-relaxed text-muted-foreground">
            {post.excerpt}
          </span>
          <span className="relative mt-auto flex items-center gap-1.5 font-medium text-tone-green">
            {t("integrations.page.readPost")}
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>
    </section>

    <section className="mx-auto mt-28 max-w-[1248px] px-6">
      <SpinBorder conic={CONIC.cta} speed="normal" radius={28} innerClassName="dark overflow-hidden bg-[#0d0d0f] text-foreground">
        <Glow color={color} opacity={0.35} blur={90} drift={1} className="-top-[120px] left-1/2 -ml-[310px] h-[300px] w-[620px]" />
        <div className="relative flex flex-col items-center gap-4 px-6 py-14 text-center">
          <Logo adapter={page.adapter} className="size-10" />
          <h2 className="max-w-[640px] text-[32px] leading-[1.08] font-semibold tracking-[-0.04em] sm:text-[40px]">
            {t("integrations.page.ctaTitle", { name })}
          </h2>
          <p className="max-w-[520px] text-base text-muted-foreground">{t("integrations.page.ctaLead")}</p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
            <Link
              href={localePath(locale, "/#start")}
              className="fx-btn flex h-[42px] items-center rounded-[10px] bg-primary px-[18px] text-[15px] font-medium text-primary-foreground"
            >
              {t("integrations.page.start")}
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="flex h-[42px] items-center rounded-[10px] border border-input bg-secondary px-[18px] text-[15px] font-medium"
            >
              {t("integrations.page.github")}
            </a>
          </div>
        </div>
      </SpinBorder>
    </section>
    </>
  );
}
