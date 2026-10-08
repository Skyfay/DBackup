"use client";

import { useState } from "react";
import {
  Activity,
  Check,
  Database,
  Download,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  type LucideIcon,
} from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

const TONE: Record<string, string> = {
  create: "bg-tone-blue/14 text-tone-blue",
  warning: "bg-tone-amber/14 text-tone-amber",
  edit: "bg-tone-violet/14 text-tone-violet",
  pick: "bg-tone-cyan/14 text-tone-cyan",
  neutral: "bg-faint/14 text-subtle",
};

const COMMANDS: { label: MessageKey; tone: string; icon: LucideIcon; hint: string }[] = [
  { label: "features.cmdNewJob", tone: "create", icon: Plus, hint: "C" },
  { label: "features.cmdRestore", tone: "warning", icon: RotateCcw, hint: "R" },
  { label: "features.cmdEditRetention", tone: "edit", icon: Pencil, hint: "E" },
  { label: "features.cmdPickDestination", tone: "pick", icon: Check, hint: "P" },
  { label: "features.cmdRunNow", tone: "neutral", icon: Play, hint: "Enter" },
  { label: "features.cmdExplorer", tone: "neutral", icon: Database, hint: "G D" },
  { label: "features.cmdFailed", tone: "neutral", icon: Activity, hint: "G H" },
  { label: "features.cmdRecoveryKit", tone: "neutral", icon: Download, hint: "" },
];

/** The Cmd K search of the app, filtering as you type. */
export function CommandCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // The search runs over the labels in the language of the page, as in the app.
  const matched = COMMANDS.filter((c) => !q || t(c.label).toLowerCase().includes(q)).slice(0, 7);

  return (
    <SpotlightCard className={cn("flex flex-col gap-4 rounded-[22px] p-6", className)}>
      <div className="relative">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">{t("features.commandTitle")}</h3>
        <p className="mt-1.5 leading-[1.55] text-muted-foreground">{t("features.commandText")}</p>
      </div>
      <div className="relative flex grow flex-col overflow-hidden rounded-[14px] border border-border-strong bg-surface-2 shadow-[var(--deep-shadow)]">
        <label className="flex h-12 items-center gap-2.5 border-b border-border-strong px-3.5 text-faint">
          <Search className="size-4 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("features.searchPlaceholder")}
            aria-label={t("features.searchLabel")}
            className="min-w-0 grow bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
          />
          <kbd className="rounded-[5px] border border-input px-1.5 py-px font-sans text-[11px]">⌘K</kbd>
        </label>
        <ul className="flex flex-col gap-px p-1.5">
          {matched.map((c, i) => (
            <li
              key={c.label}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-medium transition-colors hover:bg-accent",
                i === 0 && "bg-muted shadow-[inset_0_0_0_1px_var(--input)] hover:bg-muted"
              )}
            >
              <span className={cn("flex size-[26px] shrink-0 items-center justify-center rounded-[7px]", TONE[c.tone])}>
                <c.icon className="size-3.5" />
              </span>
              <span className="grow">{t(c.label)}</span>
              <span className="text-xs text-faint">{c.hint}</span>
            </li>
          ))}
          {matched.length === 0 && (
            <li className="px-3 py-6 text-center text-muted-foreground">{t("features.nothingMatches")}</li>
          )}
        </ul>
      </div>
    </SpotlightCard>
  );
}
