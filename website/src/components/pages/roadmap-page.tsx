import { PageBackdrop } from "@/components/site/blog/page-backdrop";
import { pageMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { INTL_LOCALE } from "@/i18n/config";
import { SHIPPED_ITEMS } from "@/lib/roadmap";
import { formatDate } from "@/lib/utils";
import { Eyebrow, Glow } from "@/components/site/fx";
import { NowSection } from "@/components/site/roadmap/now-section";
import { RoadmapTimeline } from "@/components/site/roadmap/timeline";

export function roadmapMetadata(locale: Locale) {
  const t = createTranslator(locale);
  return pageMetadata(locale, "/roadmap/", { title: t("meta.roadmapTitle"), description: t("meta.roadmapDescription") });
}

export function RoadmapPage({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  // Dates are written here, on the server, so the browser cannot spell a month
  // differently and break the hydration of the timeline.
  const monthOf = new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC" });
  const dateLabels = Object.fromEntries(SHIPPED_ITEMS.map((s) => [s.slug, formatDate(s.releaseDate, locale)]));
  const monthLabels = Object.fromEntries(
    SHIPPED_ITEMS.map((s) => [s.releaseDate.slice(0, 7), monthOf.format(new Date(s.releaseDate))])
  );
  return (
    <div className="relative">
      <PageBackdrop />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[1300px] bottom-0 overflow-hidden">
        <Glow color="#059669" opacity={0.08} blur={140} drift={1} className="top-0 left-[4%] h-[640px] w-[520px]" style={{ animationDelay: "-5s" }} />
        <Glow color="#7c3aed" opacity={0.08} blur={140} drift={1} className="top-[200px] right-[4%] h-[640px] w-[520px]" style={{ animationDelay: "-11s" }} />
      </div>

      <section className="relative z-[2] mx-auto flex max-w-[1248px] flex-col items-center gap-5 px-6 pt-[132px] text-center sm:pt-[164px]">
        <Eyebrow>{t("roadmap.eyebrow")}</Eyebrow>
        <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.045em] sm:text-[64px]">
          {t.rich("roadmap.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
        </h1>
        <p className="max-w-[640px] text-lg leading-relaxed text-muted-foreground">{t("roadmap.lead")}</p>
      </section>

      <NowSection locale={locale} />
      <RoadmapTimeline dateLabels={dateLabels} monthLabels={monthLabels} />
    </div>
  );
}
