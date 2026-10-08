"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface CompressionOption {
  name: string;
  needs: string;
  title: string;
  text: string;
  /** The level range, the default and its label, or none for an option without levels. */
  levels?: { min: number; max: number; default: number; label: string };
  command: string;
}

/** The native compression options of a dump, one picked, with its level scale and the command it runs. */
export function CompressionPicker({
  options,
  initial,
  labels,
}: {
  options: CompressionOption[];
  initial: number;
  labels: { group: string; faster: string; smaller: string };
}) {
  const [index, setIndex] = useState(initial);
  const current = options[index];
  const levels = current.levels;
  const pct = levels ? Math.round(((levels.default - levels.min) / (levels.max - levels.min)) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={labels.group} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((option, i) => {
          const on = i === index;
          return (
            <button
              key={option.name}
              type="button"
              aria-pressed={on}
              onClick={() => setIndex(i)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-[14px] border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow]",
                on ? "border-tone-blue bg-tone-blue/10 shadow-[0_0_0_3px_color-mix(in_srgb,var(--tone-blue)_12%,transparent)]" : "panel hover:border-input"
              )}
            >
              <span className="text-[15px] font-semibold">{option.name}</span>
              <span className="text-xs text-muted-foreground">{option.needs}</span>
            </button>
          );
        })}
      </div>
      <div className="panel flex flex-col gap-[18px] rounded-[18px] p-[22px]">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-semibold">{current.title}</span>
          <span className="leading-relaxed text-muted-foreground">{current.text}</span>
        </div>
        {levels && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{labels.faster}</span>
              <span className="font-medium text-foreground">{levels.label}</span>
              <span>{labels.smaller}</span>
            </div>
            <div aria-hidden="true" className="relative h-1.5 rounded-full bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-[#2563eb] to-tone-blue"
                style={{ width: `${pct}%` }}
              />
              <span
                className="absolute top-1/2 -mt-2 -ml-2 size-4 rounded-full bg-foreground shadow-[0_0_0_4px_color-mix(in_srgb,var(--tone-blue)_25%,transparent)]"
                style={{ left: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-faint tabular-nums">
              <span>{levels.min}</span>
              <span>{levels.max}</span>
            </div>
          </div>
        )}
        <div className="overflow-x-auto rounded-[10px] border border-border bg-background px-3 py-2.5 font-mono text-[13px] whitespace-nowrap">
          <span className="text-faint">$ </span>
          {current.command}
        </div>
      </div>
    </div>
  );
}
