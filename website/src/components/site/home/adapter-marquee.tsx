import { AdapterIcon } from "@/components/site/adapter-icon";
import {
  DATABASES,
  NOTIFICATION_CHANNELS,
  STORAGE_ADAPTERS,
  adapterLabel,
  type AdapterItem,
} from "@/lib/content";
import type { Locale } from "@/i18n/config";
import { createTranslator, type Translator } from "@/i18n/translate";
import { needsDarkModeBoost } from "@/lib/adapter-icons";
import { cn } from "@/lib/utils";

const MASK = "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)";

function Row({ items, reverse, t }: { items: AdapterItem[]; reverse?: boolean; t: Translator }) {
  // Two copies side by side, moved by half their width, loop without a seam.
  return (
    <div className={cn("flex w-max gap-2.5 pr-2.5", reverse ? "fx-marquee-rev" : "fx-marquee")}>
      {[...items, ...items].map((item, i) => (
        <span
          key={i}
          aria-hidden={i >= items.length ? "true" : undefined}
          className="inline-flex h-[42px] items-center gap-2.5 rounded-xl border border-border bg-surface pr-4 pl-[7px] font-medium whitespace-nowrap text-subtle"
        >
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted">
            <AdapterIcon
              adapterId={item.id}
              className={cn("size-4", needsDarkModeBoost(item.id) && "dark:brightness-200 dark:contrast-125")}
            />
          </span>
          {adapterLabel(item, t)}
        </span>
      ))}
    </div>
  );
}

export function AdapterMarquee({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div
      id="integrations"
      className="relative z-[2] mt-14 flex flex-col gap-3 overflow-hidden"
      style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    >
      <h2 className="sr-only">{t("nav.integrations")}</h2>
      <Row items={[...DATABASES, ...NOTIFICATION_CHANNELS]} t={t} />
      <Row items={STORAGE_ADAPTERS} reverse t={t} />
    </div>
  );
}
