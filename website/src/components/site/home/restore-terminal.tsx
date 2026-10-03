"use client";

import { useRef } from "react";
import { useTick } from "@/components/site/home/use-tick";
import { cn } from "@/lib/utils";

// Commands are typed two characters per tick, output lines appear whole and
// cost eight ticks, then the terminal waits a moment and starts over.
const TERM: { kind: "$" | "out" | "ok"; text: string }[] = [
  { kind: "$", text: "tar -xf nightly_2026-09-27.tar" },
  { kind: "$", text: "ls" },
  { kind: "out", text: "nextcloud.sql  files/  manifest.json" },
  { kind: "$", text: "mysql nextcloud < nextcloud.sql" },
  { kind: "ok", text: "Restored without DBackup running" },
];
const COST = (l: (typeof TERM)[number]) => (l.kind === "$" ? l.text.length : 8);
const TOTAL = TERM.reduce((sum, l) => sum + COST(l), 0);

export function RestoreTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(120, ref, (TOTAL + 1) / 2);

  let budget = (tick * 2) % (TOTAL + 60);
  const lines: { prompt: boolean; text: string; className: string }[] = [];
  for (const l of TERM) {
    if (budget <= 0) break;
    lines.push({
      prompt: l.kind === "$",
      text: l.kind === "$" ? l.text.slice(0, budget) : l.text,
      className: l.kind === "ok" ? "text-tone-green" : l.kind === "$" ? "text-[#e4e4e7]" : "text-muted-foreground",
    });
    budget -= COST(l);
  }
  const cursorOnNewLine = lines.length === 0 || !lines[lines.length - 1].prompt;

  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[var(--deep-shadow)]">
      <div className="flex h-10 items-center gap-2 border-b border-border-strong px-3.5">
        <span className="size-2.5 rounded-full bg-input" />
        <span className="size-2.5 rounded-full bg-input" />
        <span className="size-2.5 rounded-full bg-input" />
        <span className="ml-2 font-mono text-xs text-faint">~/restore</span>
      </div>
      <div className="min-h-[200px] overflow-x-auto px-[22px] py-5 font-mono text-[13px] leading-loose">
        <span className="sr-only">
          {TERM.map((l) => (l.kind === "$" ? `$ ${l.text}` : l.text)).join("\n")}
        </span>
        <div aria-hidden="true">
          {lines.map((l, i) => (
            <div key={i} className={cn("whitespace-pre", l.className)}>
              {l.prompt && <span className="text-tone-blue">$ </span>}
              {l.text}
              {!cursorOnNewLine && i === lines.length - 1 && <Cursor />}
            </div>
          ))}
          {cursorOnNewLine && (
            <div className="text-[#e4e4e7]">
              <span className="text-tone-blue">$ </span>
              <Cursor />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-4 w-2 bg-subtle align-[-3px]" />;
}
