import Link from "next/link";
import { Plug } from "lucide-react";
import { PageBackdrop } from "@/components/site/blog/page-backdrop";
import { Eyebrow, Glow } from "@/components/site/fx";
import { JsonLd } from "@/components/site/json-ld";
import { IntegrationsDirectory } from "@/components/site/integrations/directory";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { DATABASES, GITHUB_URL, NOTIFICATION_CHANNELS, STORAGE_ADAPTERS } from "@/lib/content";
import { DATABASE_NAMES, DATABASE_SLUGS } from "@/lib/integrations";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

const COUNTS = {
  databases: DATABASES.length,
  storage: STORAGE_ADAPTERS.length,
  alerts: NOTIFICATION_CHANNELS.length,
};

export function integrationsMetadata(locale: Locale) {
  const t = createTranslator(locale);
  return pageMetadata(locale, "/integrations/", {
    title: t("integrations.hub.metaTitle"),
    description: t("integrations.hub.metaDescription", COUNTS),
  });
}

export function IntegrationsPage({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const url = (path: string) => `${SITE_URL}${localePath(locale, path)}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "DBackup", item: url("/") },
      { "@type": "ListItem", position: 2, name: t("integrations.hub.eyebrow"), item: url("/integrations/") },
    ],
  };
  const pagesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("integrations.hub.databasesTitle"),
    itemListElement: DATABASE_SLUGS.map((slug, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t("integrations.page.metaTitle", { name: DATABASE_NAMES[slug] }),
      url: url(`/integrations/${slug}/`),
    })),
  };

  return (
    <div className="relative">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={pagesJsonLd} />
      <PageBackdrop />

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col items-center gap-5 px-6 pt-[132px] text-center sm:pt-[164px]">
        <Eyebrow>{t("integrations.hub.eyebrow")}</Eyebrow>
        <h1 className="max-w-[920px] text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-[64px]">
          {t.rich("integrations.hub.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
        </h1>
        <p className="max-w-[640px] text-lg leading-relaxed text-muted-foreground">{t("integrations.hub.lead", COUNTS)}</p>
      </section>

      <IntegrationsDirectory />

      <section className="relative z-[2] mx-auto max-w-[1248px] px-6 pt-20">
        <div className="panel relative flex flex-wrap items-center gap-5 overflow-hidden rounded-[20px] px-8 py-7">
          <Glow color="#22d3ee" opacity={0.12} blur={70} className="-top-20 -right-[60px] h-[240px] w-[300px]" />
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-tone-cyan/14 text-tone-cyan">
            <Plug className="size-5" />
          </span>
          <div className="relative flex flex-[1_1_320px] flex-col gap-0.5">
            <h2 className="text-base font-semibold">{t("integrations.hub.requestTitle")}</h2>
            <p className="leading-relaxed text-muted-foreground">{t("integrations.hub.requestText")}</p>
          </div>
          <div className="relative flex flex-wrap gap-2">
            <Link
              href={localePath(locale, "/roadmap/")}
              className="flex h-[38px] items-center rounded-lg border border-input bg-secondary px-3.5 font-medium"
            >
              {t("integrations.hub.roadmap")}
            </Link>
            <a
              href={`${GITHUB_URL}/issues/new?template=feature-request.yml`}
              target="_blank"
              rel="noreferrer"
              className="fx-btn flex h-[38px] items-center rounded-lg bg-primary px-3.5 font-medium text-primary-foreground"
            >
              {t("integrations.hub.request")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
