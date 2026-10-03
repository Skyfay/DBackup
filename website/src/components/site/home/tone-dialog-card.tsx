"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Check, Database } from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { useTick } from "@/components/site/home/use-tick";
import { cn } from "@/lib/utils";

type Tone = "backup" | "retain" | "pick" | "restore";

const TONES: { id: Tone; label: string; color: string }[] = [
  { id: "backup", label: "Create", color: "var(--tone-blue)" },
  { id: "retain", label: "Edit", color: "var(--tone-violet)" },
  { id: "pick", label: "Pick", color: "var(--tone-cyan)" },
  { id: "restore", label: "Warn", color: "var(--tone-amber)" },
];

type Row = { name: string; detail: string; size: string; on: boolean; tag?: "Overwrites" | "New" };

const CONTENT: Record<
  Tone,
  { title: string; note: string; foot: string; footRight: string; secondary: string; primary: string; rows: Row[] }
> = {
  backup: {
    title: "New job", note: "Step 2 of 4 · Databases", foot: "2 of 4 picked", footRight: "2.9 GB",
    secondary: "Back", primary: "Next",
    rows: [
      { name: "shop", detail: "MariaDB · prod", size: "2.1 GB", on: true },
      { name: "analytics", detail: "MariaDB · prod", size: "840 MB", on: true },
      { name: "staging", detail: "MariaDB · prod", size: "310 MB", on: false },
      { name: "wordpress", detail: "MariaDB · prod", size: "96 MB", on: false },
    ],
  },
  retain: {
    title: "Edit retention", note: "Used by 5 jobs", foot: "GFS · keeps up to 23 backups", footRight: "Every day at 02:00",
    secondary: "Cancel", primary: "Save",
    rows: [
      { name: "Keep daily", detail: "The newest backup of each day", size: "7", on: true },
      { name: "Keep weekly", detail: "The newest of each week", size: "4", on: true },
      { name: "Keep monthly", detail: "The newest of each month", size: "12", on: true },
      { name: "Keep yearly", detail: "Off", size: "0", on: false },
    ],
  },
  pick: {
    title: "Pick destinations", note: "Nextcloud nightly", foot: "2 destinations picked", footRight: "All answering",
    secondary: "Cancel", primary: "Done",
    rows: [
      { name: "Hetzner", detail: "Object Storage · fsn1", size: "31 GB", on: true },
      { name: "Cloudflare R2", detail: "S3 compatible", size: "12 GB", on: true },
      { name: "NAS", detail: "SMB · office", size: "48 GB", on: false },
      { name: "Local", detail: "/backups", size: "9 GB", on: false },
    ],
  },
  restore: {
    title: "Restore nightly_2026-09-27", note: "Overwrites 1 database on prod", foot: "2 databases to prod", footRight: "2.9 GB",
    secondary: "Cancel", primary: "Restore",
    rows: [
      { name: "shop", detail: "to shop", size: "2.1 GB", on: true, tag: "Overwrites" },
      { name: "analytics", detail: "to analytics_restored", size: "840 MB", on: true, tag: "New" },
      { name: "staging", detail: "left out", size: "310 MB", on: false },
      { name: "wordpress", detail: "left out", size: "96 MB", on: false },
    ],
  },
};

const mix = (pct: number) => `color-mix(in srgb, var(--t) ${pct}%, transparent)`;

/** The dialog of the app in each of its task colors, cycling until someone picks a tab. */
export function ToneDialogCard({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(120, ref, 0);
  const [picked, setPicked] = useState<Tone | null>(null);
  const tone = picked ?? TONES[Math.floor(tick / 32) % TONES.length].id;
  const color = TONES.find((t) => t.id === tone)!.color;
  const c = CONTENT[tone];

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
          <h3 className="text-2xl font-semibold tracking-[-0.02em]">One color per task</h3>
          <p className="mt-1.5 max-w-[360px] leading-[1.55] text-muted-foreground">
            Blue adds, violet edits, turquoise picks, amber warns. Every dialog tells you what it is
            about to do.
          </p>
        </div>
        <div role="tablist" aria-label="Tasks" className="inline-flex h-9 shrink-0 rounded-[10px] bg-muted p-[3px]">
          {TONES.map((t) => {
            const on = t.id === tone;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPicked(t.id)}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-colors",
                  on ? "bg-card text-foreground shadow-sm dark:bg-foreground/12" : "text-muted-foreground"
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: t.color, boxShadow: on ? `0 0 8px ${t.color}` : undefined }}
                />
                {t.label}
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
            <div className="truncate text-base font-semibold">{c.title}</div>
            <div className="text-xs font-medium" style={{ color: "var(--t)" }}>
              {c.note}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-5 py-4">
          <div className="overflow-hidden rounded-[10px] border border-border-strong">
            {c.rows.map((r) => (
              <div
                key={r.name}
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
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
                {r.tag && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      r.tag === "Overwrites" ? "bg-tone-amber/12 text-tone-amber" : "bg-tone-green/12 text-tone-green"
                    )}
                  >
                    {r.tag}
                  </span>
                )}
                <span className="text-[13px] text-muted-foreground tabular-nums">{r.size}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-3 text-[13px] text-muted-foreground">
            <span>{c.foot}</span>
            <span className="tabular-nums">{c.footRight}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-strong bg-background/60 px-5 py-3">
          <span className="flex h-9 items-center rounded-lg border border-input bg-secondary px-4 font-medium">
            {c.secondary}
          </span>
          <span
            className="flex h-9 items-center rounded-lg px-4 font-medium text-tone-ink transition-colors duration-300"
            style={{ background: "var(--t)", boxShadow: `0 0 20px ${mix(35)}` }}
          >
            {c.primary}
          </span>
        </div>
      </div>

      <div aria-hidden="true" className="relative flex justify-center gap-1.5">
        {TONES.map((t) => (
          <span
            key={t.id}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{ width: t.id === tone ? 22 : 6, background: t.id === tone ? t.color : "var(--input)" }}
          />
        ))}
      </div>
    </SpotlightCard>
  );
}
