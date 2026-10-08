import Image from "next/image";
import Link from "next/link";
import { CONIC, DotGrid, Floor, Glow, SpinBorder, Stars } from "@/components/site/fx";
import { RestoreTerminal } from "@/components/site/home/restore-terminal";
import { ARCHIVE_FORMAT_URL, DISCORD_URL } from "@/lib/content";
import { localePath, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";

// The two full-width bands of the home page. Both stay dark in light mode
// too: the `dark` class on the band switches every token inside it.

export function LockInBand({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section className="mx-auto mt-28 max-w-[1248px] px-6 sm:mt-[140px]">
      <SpinBorder conic={CONIC.green} radius={30} innerClassName="dark overflow-hidden bg-[#0d0d0f] text-foreground">
        <DotGrid size={22} mask="radial-gradient(ellipse 60% 70% at 75% 50%, #000, transparent 70%)" />
        <Glow color="#34d399" opacity={0.16} blur={100} drift={2} className="-bottom-40 -left-24 size-[440px]" />
        <div className="relative grid items-center gap-14 p-8 sm:p-[72px] lg:grid-cols-[5fr_6fr]">
          <div className="flex flex-col gap-[18px]">
            <span className="w-fit rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {t("lockin.badge")}
            </span>
            <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">
              {t.rich("lockin.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">{t("lockin.lead")}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={ARCHIVE_FORMAT_URL}
                target="_blank"
                rel="noreferrer"
                className="fx-btn flex h-[42px] items-center rounded-[9px] bg-primary px-[18px] font-medium text-primary-foreground"
              >
                {t("lockin.formatSpec")}
              </a>
              <Link
                href={localePath(locale, "/blog/no-global-deduplication/")}
                className="flex h-[42px] items-center rounded-[9px] border border-input bg-secondary px-[18px] font-medium"
              >
                {t("lockin.whyNoDedup")}
              </Link>
            </div>
          </div>
          <RestoreTerminal />
        </div>
      </SpinBorder>
    </section>
  );
}

export function CtaBand({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section className="mx-auto mt-28 max-w-[1248px] px-6 sm:mt-[140px]">
      <SpinBorder conic={CONIC.cta} speed="normal" radius={30} innerClassName="dark overflow-hidden bg-[#0d0d0f] text-foreground">
        <Floor className="top-[120px] h-[400px]" tilt={600} mask="linear-gradient(transparent, #000 40%, transparent)" />
        <Glow color="#2563eb" opacity={0.3} blur={100} drift={1} className="top-10 left-1/2 -ml-[300px] h-[300px] w-[600px]" />
        <Stars count={16} height={480} seed={23} />
        <div className="relative flex flex-col items-center gap-5 px-6 py-[72px] text-center sm:px-[72px] sm:py-[88px]">
          <Image
            src="/logo.svg"
            alt=""
            width={64}
            height={64}
            className="drop-shadow-[0_10px_30px_rgb(96_165_250/0.5)]"
          />
          <h2 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.04em] sm:text-[52px]">
            {t.rich("cta.title")}
          </h2>
          <p className="text-[17px] text-muted-foreground">{t("cta.lead")}</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Link
              href={localePath(locale, "/#start")}
              className="fx-btn flex h-12 items-center rounded-[10px] bg-primary px-6 text-[15px] font-medium text-primary-foreground"
            >
              {t("cta.getStarted")}
            </Link>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center rounded-[10px] border border-input bg-secondary px-6 text-[15px] font-medium"
            >
              {t("cta.discord")}
            </a>
          </div>
        </div>
      </SpinBorder>
    </section>
  );
}

