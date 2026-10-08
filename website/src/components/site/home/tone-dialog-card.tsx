"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Check, Database } from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { useTick } from "@/components/site/home/use-tick";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

type Tone = "backup" | "retain" | "pick" | "restore";

const TONES: { id: Tone; label: MessageKey; color: string }[] = [
  { id: "backup", label: "features.dialog.tabCreate", color: "var(--tone-blue)" },
  { id: "retain", label: "features.dialog.tabEdit", color: "var(--tone-violet)" },
  { id: "pick", label: "features.dialog.tabPick", color: "var(--tone-cyan)" },
  { id: "restore", label: "features.dialog.tabWarn", color: "var(--tone-amber)" },
];

// Names of databases, hosts and sizes stay as they are, the words of the app
// are keys of the messages.
type Text = string | { key: MessageKey; vars?: Record<string, string | number> };

type Row = { name: Text; detail: Text; size: string; on: boolean; tag?: "overwrites" | "new" };

const k = (key: MessageKey, vars?: Record<string, string | number>): Text => ({ key, vars });

const CONTENT: Record<
  Tone,
  { title: Text; note: Text; foot: Text; footRight: Text; secondary: Text; primary: Text; rows: Row[] }
> = {
  backup: {
    title: k("features.dialog.newJob"), note: k("features.dialog.newJobNote"), foot: k("features.dialog.picked", { count: 2, total: 4 }), footRight: "2.9 GB",
    secondary: k("features.dialog.back"), primary: k("features.dialog.next"),
    rows: [
      { name: "shop", detail: "MariaDB · prod", size: "2.1 GB", on: true },
      { name: "analytics", detail: "MariaDB · prod", size: "840 MB", on: true },
      { name: "staging", detail: "MariaDB · prod", size: "310 MB", on: false },
      { name: "wordpress", detail: "MariaDB · prod", size: "96 MB", on: false },
    ],
  },
  retain: {
    title: k("features.dialog.editRetention"), note: k("features.dialog.usedBy", { count: 5 }),
    foot: k("features.dialog.keepsUpTo", { count: 23 }), footRight: k("features.dialog.everyDayAt", { time: "02:00" }),
    secondary: k("features.dialog.cancel"), primary: k("features.dialog.save"),
    rows: [
      { name: k("features.dialog.keepDaily"), detail: k("features.dialog.keepDailyDetail"), size: "7", on: true },
      { name: k("features.dialog.keepWeekly"), detail: k("features.dialog.keepWeeklyDetail"), size: "4", on: true },
      { name: k("features.dialog.keepMonthly"), detail: k("features.dialog.keepMonthlyDetail"), size: "12", on: true },
      { name: k("features.dialog.keepYearly"), detail: k("features.dialog.off"), size: "0", on: false },
    ],
  },
  pick: {
    title: k("features.dialog.pickDestinations"), note: "Nextcloud nightly", foot: k("features.dialog.destinationsPicked", { count: 2 }),
    footRight: k("features.dialog.allAnswering"),
    secondary: k("features.dialog.cancel"), primary: k("features.dialog.done"),
    rows: [
      { name: "Hetzner", detail: "Object Storage · fsn1", size: "31 GB", on: true },
      { name: "Cloudflare R2", detail: k("adapters.s3Compatible"), size: "12 GB", on: true },
      { name: "NAS", detail: k("features.dialog.office"), size: "48 GB", on: false },
      { name: k("features.dialog.local"), detail: "/backups", size: "9 GB", on: false },
    ],
  },
  restore: {
    title: k("features.dialog.restoreTitle", { name: "nightly_2026-09-27" }), note: k("features.dialog.overwritesOne"),
    foot: k("features.dialog.databasesTo", { count: 2 }), footRight: "2.9 GB",
    secondary: k("features.dialog.cancel"), primary: k("features.dialog.restore"),
    rows: [
      { name: "shop", detail: k("features.dialog.toDb", { name: "shop" }), size: "2.1 GB", on: true, tag: "overwrites" },
      { name: "analytics", detail: k("features.dialog.toDb", { name: "analytics_restored" }), size: "840 MB", on: true, tag: "new" },
      { name: "staging", detail: k("features.dialog.leftOut"), size: "310 MB", on: false },
      { name: "wordpress", detail: k("features.dialog.leftOut"), size: "96 MB", on: false },
    ],
  },
};

const mix = (pct: number) => `color-mix(in srgb, var(--t) ${pct}%, transparent)`;

/** The dialog of the app in each of its task colors, cycling until someone picks a tab. */
export function ToneDialogCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(120, ref, 0);
  const [picked, setPicked] = useState<Tone | null>(null);
  const tone = picked ?? TONES[Math.floor(tick / 32) % TONES.length].id;
  const color = TONES.find((tn) => tn.id === tone)!.color;
  const c = CONTENT[tone];
  const tx = (v: Text) => (typeof v === "string" ? v : t(v.key, v.vars));

  return (
    <SpotlightCard
      ref={ref}
      className={cn("flex flex-col gap-6 rounded-[22px] p-6 sm:p-7", className)}
      style={{ "--t": color } as CSSProperties}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[120px] -bottom-[160px] h-[460px] w-[560px] rounded-full transition-[background] duration-500"
        style={{ background: "var(--t)", filter: "blur(90px)", opacity: "calc(0.22 * var(--glow-strength))" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          maskImage: "radial-gradient(ellipse 60% 60% at 60% 70%, #000, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 60% at 60% 70%, #000, transparent 70%)",
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-6">
        <div>
          <h3 className="text-2xl font-semibold tracking-[-0.02em]">{t("features.dialog.title")}</h3>
          <p className="mt-1.5 max-w-[360px] leading-[1.55] text-muted-foreground">{t("features.dialog.text")}</p>
        </div>
        <div role="tablist" aria-label={t("features.dialog.tasks")} className="inline-flex h-9 max-w-full shrink-0 overflow-x-auto rounded-[10px] bg-muted p-[3px]">
          {TONES.map((tn) => {
            const on = tn.id === tone;
            return (
              <button
                key={tn.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPicked(tn.id)}
                className={cn(
                  "inline-flex h-full shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:px-3",
                  on ? "bg-card text-foreground shadow-sm dark:bg-foreground/12" : "text-muted-foreground"
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: tn.color, boxShadow: on ? `0 0 8px ${tn.color}` : undefined }}
                />
                {t(tn.label)}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        className="relative w-full max-w-[560px] self-center overflow-hidden rounded-[14px] border border-border-strong bg-surface-2 shadow-[var(--deep-shadow)]"
      >
        <div
          className="flex items-center gap-3 border-b px-5 py-4 transition-colors duration-300"
          style={{ borderColor: mix(25), background: mix(10) }}
        >
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-300"
            style={{ background: mix(14), color: "var(--t)" }}
          >
            <Database className="size-4" />
          </span>
          <div className="grid min-w-0 grow gap-0.5">
            <div className="truncate text-base font-semibold">{tx(c.title)}</div>
            <div className="text-xs font-medium" style={{ color: "var(--t)" }}>
              {tx(c.note)}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-5 py-4">
          <div className="overflow-hidden rounded-[10px] border border-border-strong">
            {c.rows.map((r) => (
              <div
                key={tx(r.name)}
                className="flex items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-300",
                    !r.on && "border-input"
                  )}
                  style={r.on ? { background: "var(--t)", borderColor: "var(--t)" } : undefined}
                >
                  {r.on && <Check className="size-3 text-tone-ink" strokeWidth={3} />}
                </span>
                <div className="min-w-0 grow">
                  <div className="font-medium">{tx(r.name)}</div>
                  <div className="text-xs text-muted-foreground">{tx(r.detail)}</div>
                </div>
                {r.tag && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      r.tag === "overwrites" ? "bg-tone-amber/12 text-tone-amber" : "bg-tone-green/12 text-tone-green"
                    )}
                  >
                    {r.tag === "overwrites" ? t("features.dialog.overwrites") : t("features.dialog.new")}
                  </span>
                )}
                <span className="text-[13px] text-muted-foreground tabular-nums">{r.size}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-3 text-[13px] text-muted-foreground">
            <span>{tx(c.foot)}</span>
            <span className="tabular-nums">{tx(c.footRight)}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-strong bg-background/60 px-5 py-3">
          <span className="flex h-9 items-center rounded-lg border border-input bg-secondary px-4 font-medium">
            {tx(c.secondary)}
          </span>
          <span
            className="flex h-9 items-center rounded-lg px-4 font-medium text-tone-ink transition-colors duration-300"
            style={{ background: "var(--t)", boxShadow: `0 0 20px ${mix(35)}` }}
          >
            {tx(c.primary)}
          </span>
        </div>
      </div>

      <div aria-hidden="true" className="relative flex justify-center gap-1.5">
        {TONES.map((tn) => (
          <span
            key={tn.id}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{ width: tn.id === tone ? 22 : 6, background: tn.id === tone ? tn.color : "var(--input)" }}
          />
        ))}
      </div>
    </SpotlightCard>
  );
}
