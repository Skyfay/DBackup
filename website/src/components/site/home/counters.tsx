import type { CSSProperties } from "react";
import { DATABASES, NOTIFICATION_CHANNELS, STORAGE_ADAPTERS } from "@/lib/content";
import type { Locale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/translate";

const COUNTERS: { value: number; unit: string; label: MessageKey }[] = [
  { value: DATABASES.length, unit: "", label: "counters.databases" },
  { value: STORAGE_ADAPTERS.length, unit: "", label: "counters.storage" },
  { value: NOTIFICATION_CHANNELS.length, unit: "", label: "counters.alerts" },
  { value: 256, unit: " bit", label: "counters.aes" },
];

export function Counters({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <div className="relative z-[2] mx-auto mt-[72px] max-w-[1248px] px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {COUNTERS.map((c) => (
          <div key={c.label} className="flex flex-col-reverse bg-card px-6 py-[22px] text-left">
            <dt className="mt-0.5 text-muted-foreground">{t(c.label)}</dt>
            <dd className="text-[32px] font-semibold tracking-[-0.03em] tabular-nums sm:text-[40px]">
              <span className="sr-only">{c.value}</span>
              <span
                aria-hidden="true"
                className="fx-count"
                style={{ "--to": c.value } as CSSProperties}
              />
              <span className="text-base font-normal text-faint">{c.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
