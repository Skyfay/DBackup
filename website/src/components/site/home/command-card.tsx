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

const TONE: Record<string, string> = {
  create: "bg-tone-blue/14 text-tone-blue",
  warning: "bg-tone-amber/14 text-tone-amber",
  edit: "bg-tone-violet/14 text-tone-violet",
  pick: "bg-tone-cyan/14 text-tone-cyan",
  neutral: "bg-faint/14 text-subtle",
};

const COMMANDS: { label: string; tone: string; icon: LucideIcon; hint: string }[] = [
  { label: "New job", tone: "create", icon: Plus, hint: "C" },
  { label: "Restore a backup", tone: "warning", icon: RotateCcw, hint: "R" },
  { label: "Edit retention template", tone: "edit", icon: Pencil, hint: "E" },
  { label: "Pick a destination", tone: "pick", icon: Check, hint: "P" },
  { label: "Run Postgres nightly now", tone: "neutral", icon: Play, hint: "Enter" },
  { label: "Open Database Explorer", tone: "neutral", icon: Database, hint: "G D" },
  { label: "Show failed runs", tone: "neutral", icon: Activity, hint: "G H" },
  { label: "Download Recovery Kit", tone: "neutral", icon: Download, hint: "" },
];

/** The Cmd K search of the app, filtering as you type. */
export function CommandCard({ className }: { className?: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matched = COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 7);

  return (
    <SpotlightCard className={cn("flex flex-col gap-4 rounded-[22px] p-6", className)}>
      <div className="relative">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">Everything is one keystroke away</h3>
        <p className="mt-1.5 leading-[1.55] text-muted-foreground">Try it. Type to filter.</p>
      </div>
      <div className="relative flex grow flex-col overflow-hidden rounded-[14px] border border-border-strong bg-surface-2 shadow-[var(--deep-shadow)]">
        <label className="flex h-12 items-center gap-2.5 border-b border-border-strong px-3.5 text-faint">
          <Search className="size-4 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs, backups, pages"
            aria-label="Search commands"
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
              <span className="grow">{c.label}</span>
              <span className="text-xs text-faint">{c.hint}</span>
            </li>
          ))}
          {matched.length === 0 && (
            <li className="px-3 py-6 text-center text-muted-foreground">Nothing matches that</li>
          )}
        </ul>
      </div>
    </SpotlightCard>
  );
}
