import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, Info } from "lucide-react";
import { PageBackdrop } from "@/components/site/blog/page-backdrop";
import { CodeBlock } from "@/components/site/code-block";
import { CodeLines } from "@/components/site/code-lines";
import { FaqList } from "@/components/site/faq-list";
import { Eyebrow, Glow } from "@/components/site/fx";
import { JsonLd } from "@/components/site/json-ld";
import { EngineVisual } from "@/components/site/integrations/engine-visual";
import { ArchiveTree, FormPanel, Logo, RecoveryTerminal } from "@/components/site/integrations/page-parts";
import { PageEnd, RELATED_POST } from "@/components/site/integrations/page-end";
import { RunCard } from "@/components/site/integrations/run-card";
import { SetupSteps } from "@/components/site/integrations/setup-steps";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator, stripTags } from "@/i18n/translate";
import { DESTINATION_COUNT } from "@/lib/content";
import { highlight } from "@/lib/highlight";
import {
  DATABASE_COLORS,
  DATABASE_NAMES,
  DATABASE_PAGES,
  DATABASE_SLUGS,
  composeFile,
  isDatabaseSlug,
} from "@/lib/integrations";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

export function databasePageParams() {
  return DATABASE_SLUGS.map((slug) => ({ slug }));
}

export function databaseMetadata(locale: Locale, slug: string) {
  if (!isDatabaseSlug(slug)) return {};
  const t = createTranslator(locale);
  return pageMetadata(locale, `/integrations/${slug}/`, {
    title: t("integrations.page.seoTitle", { name: DATABASE_NAMES[slug] }),
    description: t(`integrations.db.${slug}.description`),
    image: localePath(locale, `/integrations/${slug}/og.png`),
  });
}

const code = (chunks: ReactNode) => <code className="font-mono text-[0.92em] text-foreground">{chunks}</code>;

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-[28px] leading-[1.1] font-semibold tracking-[-0.035em] sm:text-4xl", className)}>{children}</h2>
  );
}

export async function DatabasePage({ locale, slug }: { locale: Locale; slug: string }) {
  if (!isDatabaseSlug(slug)) notFound();
  const t = createTranslator(locale);
  const page = DATABASE_PAGES[slug];
  const name = DATABASE_NAMES[slug];
  const color = DATABASE_COLORS[page.adapter];
  const key = <K extends string>(k: K) => `integrations.db.${slug}.${k}` as const;
  const pageUrl = `${SITE_URL}${localePath(locale, `/integrations/${slug}/`)}`;

  const [compose, access] = await Promise.all([
    highlight(composeFile(page), "yaml"),
    highlight(page.access.code, page.access.lang),
  ]);

  const faq = ([1, 2, 3, 4, 5] as const).map((n) => ({ q: t(key(`q${n}`)), a: t(key(`a${n}`)) }));

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "DBackup", item: `${SITE_URL}${localePath(locale, "/")}` },
      { "@type": "ListItem", position: 2, name: t("integrations.hub.eyebrow"), item: `${SITE_URL}${localePath(locale, "/integrations/")}` },
      { "@type": "ListItem", position: 3, name, item: pageUrl },
    ],
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: locale,
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: stripTags(item.a) },
    })),
  };

  const runSteps = [
    { name: t("integrations.page.runConnect"), detail: t("integrations.page.runDirect", { host: page.run.host }), result: page.run.version },
    { name: t("integrations.page.runDump"), detail: page.run.dump, command: true, result: page.run.size },
    {
      name: t("integrations.page.runEncrypt"),
      detail: page.run.gzip ? t("integrations.page.runGzipCipher") : t("integrations.page.runCipher"),
      result: t("integrations.page.runSealed"),
    },
    { name: t("integrations.page.runUpload"), detail: "Hetzner Object Storage", result: "6.1 s" },
    {
      name: t("integrations.page.runRetention"),
      detail: t("integrations.page.runRetentionDetail"),
      result: t("integrations.page.runPruned", { count: 2 }),
    },
    { name: t("integrations.page.runNotify"), detail: "Discord · #backups", result: t("integrations.page.runSent") },
  ];

  const steps = [
    { tone: "bg-tone-blue/14 text-tone-blue-soft", title: t("integrations.page.stepDump"), text: t.rich(key("dumpStep"), { code }) },
    { tone: "bg-tone-cyan/14 text-tone-cyan", title: t("integrations.page.stepCompress"), text: t.rich(key("compressStep"), { code }) },
    { tone: "bg-tone-violet/14 text-tone-violet", title: t("integrations.page.stepEncrypt"), text: t("integrations.page.encryptStep") },
    {
      tone: "bg-tone-green/14 text-tone-green",
      title: t("integrations.page.stepStore"),
      text: t.rich(
        "integrations.page.storeStep",
        {
          link: (c) => (
            <Link href={localePath(locale, "/integrations/#storage")} className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
              {c}
            </Link>
          ),
        },
        { count: DESTINATION_COUNT }
      ),
    },
  ];

  const setup = [
    {
      title: t("integrations.page.setupStartTitle", { name }),
      text: t("integrations.page.setupStartText"),
      file: "docker-compose.yml",
      panel: (
        <CodeBlock>
          <CodeLines lines={compose} />
        </CodeBlock>
      ),
    },
    {
      title: t(key("userTitle")),
      text: t(key("userText")),
      file: page.access.file,
      panel: (
        <CodeBlock>
          <CodeLines lines={access} />
        </CodeBlock>
      ),
    },
    {
      title: t("integrations.page.setupFormTitle"),
      text: t("integrations.page.setupFormText"),
      file: "Connections › Databases › New database",
      panel: <FormPanel locale={locale} slug={slug} />,
    },
  ];

  return (
    <div className="relative">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={faqJsonLd} />
      <PageBackdrop />
      <Glow color={color} opacity={0.32} blur={130} drift={1} className="-top-16 left-[4%] h-[480px] w-[560px]" />

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col gap-10 px-6 pt-[124px] sm:pt-[156px]">
        <nav aria-label={t("blog.breadcrumb")} className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <Link href={localePath(locale, "/")} className="transition-colors hover:text-foreground">
            DBackup
          </Link>
          <ChevronRight aria-hidden="true" className="size-3.5 text-fainter" />
          <Link href={localePath(locale, "/integrations/")} className="transition-colors hover:text-foreground">
            {t("integrations.hub.eyebrow")}
          </Link>
          <ChevronRight aria-hidden="true" className="size-3.5 text-fainter" />
          <span aria-current="page" className="font-medium text-foreground">
            {name}
          </span>
        </nav>

        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="flex flex-col items-start gap-5">
            <span className="flex items-center gap-3">
              <span
                className="flex size-[52px] items-center justify-center rounded-[14px] border border-border-strong bg-surface"
                style={{ boxShadow: `0 0 40px color-mix(in srgb, ${color} 55%, transparent)` }}
              >
                <Logo adapter={page.adapter} className="size-7" />
              </span>
              <Eyebrow>{t("integrations.page.eyebrow")}</Eyebrow>
            </span>
            <h1 className="text-[38px] leading-[1.05] font-semibold tracking-[-0.045em] sm:text-[58px]">
              {t.rich(key("heroTitle"), { shine: (c) => <span className="fx-shine">{c}</span> })}
            </h1>
            <p className="max-w-[560px] text-lg leading-relaxed text-muted-foreground">{t.rich(key("lead"), { code })}</p>
            <div className="flex flex-wrap gap-2.5">
              <Link
                href={localePath(locale, "/#start")}
                className="fx-btn group flex h-[42px] items-center gap-2 rounded-[10px] bg-primary px-[18px] text-[15px] font-medium text-primary-foreground"
              >
                {t("integrations.page.start")}
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <a
                href={page.docs}
                target="_blank"
                rel="noreferrer"
                className="flex h-[42px] items-center rounded-[10px] border border-input bg-secondary px-[18px] text-[15px] font-medium"
              >
                {t("integrations.page.guide", { name })}
              </a>
            </div>
            <span className="text-[13px] text-faint">{t("integrations.page.openSource")}</span>
          </div>
          <RunCard
            job={page.run.job}
            schedule={t("integrations.page.runSchedule")}
            steps={runSteps}
            running={t("integrations.page.runRunning")}
            finished={t("integrations.page.runFinished")}
            note={t("integrations.page.runNote")}
          />
        </div>
      </section>

      <section className="relative z-[2] mx-auto max-w-[1248px] px-6 pt-16">
        <dl className="grid overflow-hidden rounded-[18px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4 gap-px">
          {([1, 2, 3, 4] as const).map((n) => (
            <div key={n} className="flex flex-col-reverse gap-1 bg-card px-5 py-[18px]">
              <dt className="text-[13px] text-muted-foreground">{t(key(`fact${n}Label`))}</dt>
              <dd className="text-xl font-semibold tracking-[-0.02em]">{t(key(`fact${n}Value`))}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col gap-7 px-6 pt-28">
        <div className="flex max-w-[640px] flex-col gap-2.5">
          <SectionTitle>{t("integrations.page.stepsTitle", { name })}</SectionTitle>
          <p className="text-base leading-relaxed text-muted-foreground">{t("integrations.page.stepsLead")}</p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="panel flex flex-col gap-3 rounded-[18px] p-[22px]">
              <span className={cn("flex size-9 items-center justify-center rounded-[10px] font-semibold", step.tone)}>{i + 1}</span>
              <span className="text-[17px] font-semibold">{step.title}</span>
              <span className="leading-relaxed text-muted-foreground">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative z-[2] mx-auto grid max-w-[1248px] items-start gap-10 px-6 pt-28 lg:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <SectionTitle>{t(key("featureTitle"))}</SectionTitle>
          <p className="text-base leading-relaxed text-muted-foreground">{t.rich(key("featureText"), { code })}</p>
          <p className="panel mt-1.5 flex gap-3 rounded-[14px] px-4 py-3.5 leading-relaxed text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-tone-amber" />
            {t(key("featureNote"))}
          </p>
        </div>
        <EngineVisual slug={slug} locale={locale} />
      </section>

      <section className="relative z-[2] mx-auto grid max-w-[1248px] items-center gap-10 px-6 pt-28 lg:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <SectionTitle>{t(key("archiveTitle"))}</SectionTitle>
          <p className="text-base leading-relaxed text-muted-foreground">{t(key("archiveText"))}</p>
          <ul className="mt-1 flex flex-col gap-2.5 leading-relaxed">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[9px] size-1.5 shrink-0 rounded-full bg-tone-green shadow-[0_0_8px_var(--tone-green)]" />
                <span>{t.rich(key(`archive${n}`), { code })}</span>
              </li>
            ))}
          </ul>
        </div>
        <ArchiveTree entries={page.archive} caption={t("integrations.page.archiveCaption")} />
      </section>

      <section className="relative z-[2] mx-auto grid max-w-[1248px] items-center gap-10 px-6 pt-28 lg:grid-cols-2">
        <RecoveryTerminal lines={page.recovery} caption={t("integrations.page.restoreCaption")} />
        <div className="flex flex-col gap-3.5">
          <SectionTitle>{t("integrations.page.restoreTitle")}</SectionTitle>
          <p className="text-base leading-relaxed text-muted-foreground">{t.rich(key("restoreLead"), { code })}</p>
          <p className="leading-relaxed text-muted-foreground">{t("integrations.page.restoreKit")}</p>
          <Link
            href={localePath(locale, `/blog/${RELATED_POST}/`)}
            className="w-fit font-medium text-tone-blue-soft underline decoration-tone-blue-soft/35 underline-offset-4 hover:decoration-tone-blue-soft"
          >
            {t("integrations.page.restoreLink")}
          </Link>
        </div>
      </section>

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col gap-7 px-6 pt-28">
        <div className="flex max-w-[640px] flex-col gap-2.5">
          <SectionTitle>{t("integrations.page.setupTitle")}</SectionTitle>
          <p className="text-base leading-relaxed text-muted-foreground">{t("integrations.page.setupLead")}</p>
        </div>
        <SetupSteps steps={setup} label={t("integrations.page.setupSteps")} />
      </section>

      <section className="relative z-[2] mx-auto flex max-w-[880px] flex-col gap-6 px-6 pt-28">
        <SectionTitle className="text-center">{t("integrations.page.faqTitle", { name })}</SectionTitle>
        <FaqList items={faq} idPrefix={`faq-${slug}`} />
      </section>

      <PageEnd locale={locale} slug={slug} />
    </div>
  );
}
