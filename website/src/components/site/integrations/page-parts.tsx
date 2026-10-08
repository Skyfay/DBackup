import { Info, Terminal } from "lucide-react";
import { AdapterIcon } from "@/components/site/adapter-icon";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { needsDarkModeBoost } from "@/lib/adapter-icons";
import { DATABASE_PAGES, type ArchiveEntry, type DatabaseSlug } from "@/lib/integrations";
import { cn } from "@/lib/utils";

// Parts of a database page that only draw the data of the page.

export function Logo({ adapter, className }: { adapter: string; className?: string }) {
  return (
    <AdapterIcon
      adapterId={adapter}
      className={cn(className, needsDarkModeBoost(adapter) && "dark:brightness-200 dark:contrast-125")}
    />
  );
}

export function ArchiveTree({ entries, caption }: { entries: ArchiveEntry[]; caption: string }) {
  const badge: Record<ArchiveEntry["kind"], [string, string]> = {
    tar: ["TAR", "text-tone-amber"],
    file: ["{ }", "text-muted-foreground"],
    folder: ["DIR", "text-tone-blue"],
    dump: ["DB", "text-tone-green"],
  };
  return (
    <figure className="relative overflow-hidden rounded-[20px] border border-border bg-background p-[22px] dark:bg-[#0d0d0f]">
      <span aria-hidden="true" className="bg-dot-grid absolute inset-0 [background-size:18px_18px]" />
      <ul className="relative flex flex-col gap-1.5 font-mono text-[13px]">
        {entries.map((entry) => (
          <li
            key={entry.name}
            className="flex min-h-10 items-center gap-2.5 rounded-[10px] border border-border bg-surface/90 px-3"
            style={{ paddingLeft: 12 + entry.depth * 18 }}
          >
            <span className={cn("w-8 shrink-0 text-center text-[10px] font-semibold", badge[entry.kind][1])}>
              {badge[entry.kind][0]}
            </span>
            <span className="min-w-0 grow truncate text-foreground">{entry.name}</span>
            {entry.size && <span className="shrink-0 text-faint">{entry.size}</span>}
          </li>
        ))}
      </ul>
      <figcaption className="relative mt-3.5 text-xs text-faint">{caption}</figcaption>
    </figure>
  );
}

export function FormPanel({ locale, slug }: { locale: Locale; slug: DatabaseSlug }) {
  const t = createTranslator(locale);
  const page = DATABASE_PAGES[slug];
  const rows: [string, string][] = [
    [t("integrations.page.formConnects"), t("integrations.page.formDirect")],
    [t("integrations.page.formHost"), page.service.name],
    [t("integrations.page.formPort"), page.service.port],
    [t("integrations.page.formLogin"), t("integrations.page.formLoginValue")],
    ...(page.authDatabase ? [[t("integrations.page.formAuthDatabase"), "admin"] as [string, string]] : []),
  ];
  return (
    <div className="flex flex-col gap-4 p-5">
      <dl className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-blue" />
        {t("integrations.page.formNote")}
      </p>
    </div>
  );
}


/** The commands of a restore without DBackup, in a terminal that stays dark in light mode too. */
export function RecoveryTerminal({ lines, caption }: { lines: string[]; caption: string }) {
  return (
    <div className="dark order-last min-w-0 overflow-hidden rounded-[20px] border border-border-strong bg-[#0d0d0f] text-foreground lg:order-none">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3.5 text-xs text-faint">
        <Terminal aria-hidden="true" className="size-3.5" />
        {caption}
      </div>
      <pre className="overflow-x-auto px-[18px] py-4 font-mono text-[13px] leading-[1.9] text-[#e4e4e7]">
        {lines.map((line) => (
          <span key={line} className="block">
            <span className="text-faint">$ </span>
            {line.slice(2)}
          </span>
        ))}
      </pre>
    </div>
  );
}
