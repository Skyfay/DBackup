"use client";

import { useEffect, useState } from "react";
import { Check, Globe, Languages } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useI18n } from "@/i18n/provider";
import Image, { type StaticImageData } from "next/image";
import { LANG_STORAGE_KEY, LOCALES, isLocale, switchLocalePath, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import flagUs from "flag-icons/flags/4x3/us.svg";
import flagDe from "flag-icons/flags/4x3/de.svg";

type Choice = Locale | "auto";

const ITEM = "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[highlighted]:bg-accent";

/**
 * The flag of each language, taken one by one from flag-icons. Its CSS would
 * ship every flag of the world with the site, so a new language imports its
 * own flag here.
 */
const FLAGS: Record<Locale, StaticImageData> = { en: flagUs as StaticImageData, de: flagDe as StaticImageData };

export function LocaleFlag({ locale, className }: { locale: Locale; className?: string }) {
  return (
    <Image
      src={FLAGS[locale]}
      alt=""
      aria-hidden="true"
      width={20}
      height={15}
      className={cn("h-[1em] w-[1.333em] shrink-0 rounded-[3px] object-cover", className)}
    />
  );
}

/** The language Auto stands for: the first one of the browser the site has. */
function browserLocale(): Locale {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of list) {
    const code = tag.toLowerCase().split("-")[0];
    if (isLocale(code)) return code;
  }
  return "en";
}

function readChoice(): Choice {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLocale(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/**
 * The choice between Auto and every language, like in the app. Auto follows
 * the browser, a language picked here wins over it, and the page moves to its
 * version in that language.
 */
export function useLanguageChoice() {
  const { locale } = useI18n();
  const [choice, setChoice] = useState<Choice | null>(null);

  // localStorage only exists in the browser, so the choice is read after mounting.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setChoice(readChoice()), []);

  function pick(next: Choice) {
    try {
      if (next === "auto") localStorage.removeItem(LANG_STORAGE_KEY);
      else localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Without storage the choice only holds for this page.
    }
    setChoice(next);
    const target = next === "auto" ? browserLocale() : next;
    if (target !== locale) {
      // The real path keeps its trailing slash, which usePathname would drop.
      const { pathname, search, hash } = window.location;
      window.location.assign(switchLocalePath(pathname, target) + search + hash);
    }
  }

  return { choice, pick };
}

export function LanguageSwitcher() {
  const { t, locale } = useI18n();
  const { choice, pick } = useLanguageChoice();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${t("lang.label")}: ${t(`lang.${locale}`)}`}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-secondary px-2.5 text-[13px] font-medium transition-colors hover:bg-accent"
        >
          <Languages className="size-4" />
          <span className="uppercase">{locale}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          aria-label={t("lang.label")}
          className="z-50 min-w-[180px] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-[var(--deep-shadow)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.RadioGroup value={choice ?? undefined} onValueChange={(v) => pick(v as Choice)}>
            <DropdownMenu.RadioItem value="auto" className={ITEM}>
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="grow">{t("lang.auto")}</span>
              <DropdownMenu.ItemIndicator>
                <Check className="size-3.5 text-tone-green" strokeWidth={2.6} />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
            <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
            {LOCALES.map((l) => (
              <DropdownMenu.RadioItem key={l} value={l} className={ITEM}>
                <LocaleFlag locale={l} className="text-base" />
                <span lang={l} className="grow">
                  {t(`lang.${l}`)}
                </span>
                <DropdownMenu.ItemIndicator>
                  <Check className="size-3.5 text-tone-green" strokeWidth={2.6} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
