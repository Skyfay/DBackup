import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { AdapterIcon } from "@/components/site/adapter-icon";
import { ContributorsPill } from "@/components/site/home/contributors-pill";
import { LiveRun } from "@/components/site/home/live-run";
import { Counters } from "@/components/site/home/counters";
import { AdapterMarquee } from "@/components/site/home/adapter-marquee";
import { CONIC, DotGrid, Floor, Glow, Stars } from "@/components/site/fx";
import { SHIPPED_ITEMS, shippedHref } from "@/lib/roadmap";
import { needsDarkModeBoost } from "@/lib/adapter-icons";
import { cn } from "@/lib/utils";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";

/** The release the New pill above the title links to, the latest one on the roadmap. */
const LATEST_RELEASE = SHIPPED_ITEMS.find((item) => item.version) ?? SHIPPED_ITEMS[0];

// The rolling name in the headline. The first entry comes again at the end,
// so the loop back to the top cannot be seen.
// Each tile takes the color of its logo, and the two red ones never follow
// each other.
const TICKER = [
  { id: "postgres", label: "PostgreSQL", rgb: "37 99 235" },
  { id: "redis", label: "Redis", rgb: "220 38 38" },
  { id: "mongodb", label: "MongoDB", rgb: "21 128 61" },
  { id: "mssql", label: "SQL Server", rgb: "204 41 39" },
  { id: "mysql", label: "MySQL", rgb: "14 116 144" },
];

function Ticker() {
  return (
    <span className="box-content inline-flex h-[1.158em] w-[5.55em] overflow-hidden rounded-[0.29em] border border-foreground/15 bg-surface-2/70 text-left shadow-[inset_0_1px_0_var(--highlight),0_20px_50px_-20px_rgb(37_99_235/0.6)]">
      <span className="fx-ticker flex w-full flex-col self-start">
        {[...TICKER, TICKER[0]].map((item, i) => (
          <span
            key={i}
            aria-hidden={i > 0 ? "true" : undefined}
            className="flex h-[1.5714em] shrink-0 items-center gap-[0.29em] pr-[0.36em] pl-[0.25em] text-[0.737em]"
          >
            <span
              className="flex size-[1em] shrink-0 items-center justify-center rounded-[0.25em]"
              style={{
                background: `rgb(${item.rgb} / 0.18)`,
                boxShadow: `0 0 24px rgb(${item.rgb} / 0.35)`,
              }}
            >
              <AdapterIcon
                adapterId={item.id}
                className={cn("size-[0.6em]", needsDarkModeBoost(item.id) && "dark:brightness-200")}
              />
            </span>
            {item.label}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Hero({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section aria-label={t("hero.intro")} className="relative overflow-hidden pb-24">
      <Glow color="#2563eb" opacity={0.28} drift={1} className="top-[120px] left-[6%] size-[560px]" />
      <Glow color="#7c3aed" opacity={0.24} drift={2} className="top-[60px] right-[4%] size-[520px]" />
      <Glow color="#0891b2" opacity={0.2} drift={1} className="top-[700px] left-[38%] h-[420px] w-[480px]" />
      <DotGrid mask="radial-gradient(ellipse 60% 45% at 50% 22%, #000, transparent 75%)" />
      <div
        aria-hidden="true"
        className="fx-border fx-spin-slower pointer-events-none absolute -top-[500px] left-1/2 -ml-[700px] size-[1400px] rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, transparent, rgb(96 165 250 / 0.35), transparent 25%, rgb(167 139 250 / 0.3), transparent 50%, rgb(34 211 238 / 0.3), transparent 75%)",
          filter: "blur(80px)",
          opacity: "calc(0.55 * var(--glow-strength))",
        }}
      />
      <Stars count={36} height={1400} />
      <Floor className="top-[560px] h-[700px]" />

      <div className="relative z-[2] mx-auto flex max-w-[1200px] flex-col items-center gap-[26px] px-6 pt-[140px] text-center sm:pt-[172px]">
        <a
          href={shippedHref(LATEST_RELEASE)}
          target="_blank"
          rel="noreferrer"
          className="relative inline-flex overflow-hidden rounded-full bg-foreground/10 p-px"
        >
          <span
            aria-hidden="true"
            className="fx-spin absolute top-1/2 left-1/2 -mt-[200px] -ml-[200px] size-[400px]"
            style={{ background: CONIC.pill }}
          />
          <span className="relative inline-flex h-[30px] items-center gap-2 rounded-full bg-card pr-3 pl-1.5 text-[13px] font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-green/14 px-2 py-0.5 text-xs text-tone-green">
              <span className="relative size-1.5">
                <span className="fx-ping absolute inset-0 rounded-full bg-tone-green" />
                <span className="absolute inset-0 rounded-full bg-tone-green" />
              </span>
              {t("hero.new")}
            </span>
            {t("hero.news")}
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </span>
        </a>

        <h1 className="text-[40px] leading-[1.08] font-semibold tracking-[-0.045em] sm:text-[56px] lg:text-[76px]">
          <span className="flex flex-wrap items-center justify-center gap-x-[0.26em] gap-y-2">
            {t("hero.backupsFor")} <Ticker />
          </span>
          <span className="fx-shine block">{t("hero.line2")}</span>
        </h1>

        <p className="max-w-[620px] text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t("hero.lead")}
        </p>

        <div className="flex flex-wrap justify-center gap-2.5">
          <Link
            href={localePath(locale, "/#start")}
            className="fx-btn flex h-[46px] items-center gap-2 rounded-[10px] bg-primary px-[22px] text-[15px] font-medium text-primary-foreground"
          >
            {t("hero.getStarted")}
            <ArrowRight className="size-4" />
          </Link>
          <ContributorsPill />
        </div>
      </div>

      <LiveRun />
      <Counters locale={locale} />
      <AdapterMarquee locale={locale} />
    </section>
  );
}
