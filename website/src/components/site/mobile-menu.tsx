"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronRight, Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useTheme } from "next-themes";
import { CONIC, Glow } from "@/components/site/fx";
import { GithubStarsWidget } from "@/components/site/github-stars-widget";
import { INTEGRATION_COUNTS, NAV_LINKS, useActiveHref, useNavHref } from "@/components/site/nav-links";
import { LocaleFlag, useLanguageChoice } from "@/components/site/language-switcher";
import { useI18n } from "@/i18n/provider";
import { LOCALES } from "@/i18n/config";
import { DISCORD_URL } from "@/lib/content";
import { SHIPPED_ITEMS } from "@/lib/roadmap";
import { cn } from "@/lib/utils";

const LATEST_VERSION = SHIPPED_ITEMS.find((s) => s.version)?.version;

const THEMES = [
  { value: "light", label: "nav.themeLight", icon: Sun },
  { value: "dark", label: "nav.themeDark", icon: Moon },
  { value: "system", label: "nav.themeSystem", icon: Monitor },
] as const;

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.08.08 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.08.08 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.08.08 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.08.08 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.07.07 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.07.07 0 0 1 .078.01c.12.098.246.198.373.292a.08.08 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.08.08 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.08.08 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.08.08 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

/**
 * The menu below lg: a panel that grows out of the header, with a tinted
 * icon and a line of text for every page, the theme, the stars and the two
 * calls to action. Radix keeps focus inside and closes it on Escape.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const { t, path } = useI18n();
  const active = useActiveHref();
  const hrefOf = useNavHref();
  const { choice, pick } = useLanguageChoice();
  const { theme, setTheme } = useTheme();
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={t("nav.openMenu")}
          className="flex size-9 items-center justify-center rounded-lg border border-input bg-secondary lg:hidden"
        >
          <Menu className="size-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fx-drop fixed inset-x-3 top-3 z-50 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[22px] outline-none sm:top-5 sm:right-4 sm:left-auto sm:w-[400px]"
        >
          <div className="relative overflow-hidden rounded-[22px] bg-foreground/10 p-px shadow-[0_40px_80px_-20px_rgb(0_0_0/0.6),0_30px_80px_-30px_rgb(37_99_235/0.45)]">
            <span
              aria-hidden="true"
              className="fx-border fx-spin absolute top-1/2 left-1/2 -mt-[600px] -ml-[600px] size-[1200px]"
              style={{ background: CONIC.blue }}
            />
            <div className="relative overflow-hidden rounded-[21px] bg-card/97">
              <Glow color="#2563eb" opacity={0.22} blur={60} className="-top-20 -right-16 h-[220px] w-[260px]" />

              <div className="relative flex h-14 items-center gap-2.5 border-b border-border pr-2 pl-3.5">
                <Image src="/logo.svg" alt="" width={26} height={26} />
                <Dialog.Title className="font-semibold">DBackup</Dialog.Title>
                {LATEST_VERSION && (
                  <span className="ml-1 rounded-full bg-tone-green/14 px-[7px] py-px font-mono text-[11px] font-medium text-tone-green">
                    {LATEST_VERSION}
                  </span>
                )}
                <Dialog.Close
                  aria-label={t("nav.closeMenu")}
                  className="ml-auto flex size-10 items-center justify-center rounded-[10px] border border-input bg-secondary"
                >
                  <X className="size-[18px]" />
                </Dialog.Close>
              </div>

              <nav aria-label={t("nav.main")} className="relative flex flex-col gap-0.5 p-2">
                {NAV_LINKS.map((link, i) => {
                  const on = link.href === active;
                  const color = `var(--tone-${link.tone})`;
                  const tint = (pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
                  const Arrow = link.external ? ArrowUpRight : ChevronRight;
                  return (
                    <Link
                      key={link.href}
                      href={hrefOf(link)}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noreferrer" : undefined}
                      aria-current={on ? "page" : undefined}
                      onClick={close}
                      className={cn(
                        "fx-rise flex items-center gap-3.5 rounded-[14px] px-3 py-2.5 transition-[background-color,transform] duration-150 active:scale-[0.98]",
                        !on && "hover:bg-foreground/[0.04]"
                      )}
                      style={
                        {
                          animationDelay: `${0.05 + i * 0.045}s`,
                          ...(on && {
                            background: `linear-gradient(90deg, ${tint(14)}, ${tint(3)})`,
                            boxShadow: `inset 0 0 0 1px ${tint(25)}`,
                          }),
                        } as CSSProperties
                      }
                    >
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          background: tint(14),
                          color,
                          boxShadow: on ? `0 0 20px ${tint(45)}` : undefined,
                        }}
                      >
                        <link.icon className="size-[18px]" />
                      </span>
                      <span className="flex min-w-0 grow flex-col gap-px">
                        <span className="text-[17px] font-semibold tracking-[-0.01em]">{t(link.label)}</span>
                        <span className="truncate text-[13px] text-muted-foreground">{t(link.caption, INTEGRATION_COUNTS)}</span>
                      </span>
                      {on ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-tone-green">
                          <span className="relative size-1.5">
                            <span className="fx-ping absolute inset-0 rounded-full bg-tone-green" />
                            <span className="absolute inset-0 rounded-full bg-tone-green" />
                          </span>
                          {t("nav.here")}
                        </span>
                      ) : (
                        <Arrow className="size-4 shrink-0 text-fainter" />
                      )}
                    </Link>
                  );
                })}
              </nav>

              <div className="fx-rise relative mx-4 mt-1 flex items-center gap-2 border-t border-border pt-3.5" style={{ animationDelay: "0.3s" }}>
                <div role="radiogroup" aria-label={t("nav.theme")} className="flex h-10 grow rounded-[11px] bg-muted p-[3px]">
                  {THEMES.map((th) => {
                    const on = theme === th.value;
                    return (
                      <button
                        key={th.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={t(th.label)}
                        onClick={() => setTheme(th.value)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-all duration-250",
                          on ? "grow-[2] bg-card text-foreground shadow-sm dark:bg-foreground/12" : "grow text-faint"
                        )}
                      >
                        <th.icon className="size-[15px]" />
                        {on && t(th.label)}
                      </button>
                    );
                  })}
                </div>
                <GithubStarsWidget className="flex h-10 rounded-[11px]" />
              </div>

              <div className="fx-rise relative mx-4 mt-2.5" style={{ animationDelay: "0.33s" }}>
                <div role="radiogroup" aria-label={t("lang.label")} className="flex h-10 rounded-[11px] bg-muted p-[3px]">
                  {(["auto", ...LOCALES] as const).map((c) => {
                    const on = choice === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => pick(c)}
                        className={cn(
                          "flex grow items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors",
                          on ? "bg-card text-foreground shadow-sm dark:bg-foreground/12" : "text-faint"
                        )}
                      >
                        {c !== "auto" && <LocaleFlag locale={c} />}
                        {c === "auto" ? t("lang.auto") : <span lang={c}>{t(`lang.${c}`)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="fx-rise relative flex flex-col gap-2 px-4 pt-3.5 pb-4" style={{ animationDelay: "0.36s" }}>
                <Link
                  href={path("/#start")}
                  onClick={close}
                  className="flex h-[50px] items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-[0_12px_30px_-12px_rgb(96_165_250/0.6)]"
                >
                  {t("nav.getStarted")}
                  <ArrowRight className="size-[17px]" />
                </Link>
                <a
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl font-medium text-subtle"
                >
                  <DiscordGlyph className="size-4 text-[#6366f1] dark:text-[#a5b4fc]" />
                  {t("nav.discord")}
                </a>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
