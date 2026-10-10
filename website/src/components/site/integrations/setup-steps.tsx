"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SetupStep {
  title: string;
  text: string;
  /** The name above the panel, a file name or the place in the app. */
  file: string;
  panel: ReactNode;
}

/**
 * The steps of a setup as tabs on the left, the file or form of the picked
 * one on the right. The arrow keys move between the steps.
 */
export function SetupSteps({ steps, label }: { steps: SetupStep[]; label: string }) {
  const [index, setIndex] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = steps[index];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = (index + move + steps.length) % steps.length;
    setIndex(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div role="tablist" aria-label={label} aria-orientation="vertical" className="flex flex-col gap-1">
        {steps.map((step, i) => {
          const on = i === index;
          return (
            <button
              key={step.title}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={on}
              aria-controls={`${id}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setIndex(i)}
              onKeyDown={onKeyDown}
              className={cn(
                "flex w-full items-start gap-3.5 rounded-[14px] border p-3.5 text-left transition-colors",
                on ? "border-border-strong bg-surface" : "border-transparent hover:bg-surface/60"
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold",
                  on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{step.title}</span>
                <span className="text-[13px] leading-relaxed text-muted-foreground">{step.text}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${index}`}
        className="min-w-0 overflow-hidden rounded-[20px] border border-border bg-card"
      >
        <div className="flex h-10 items-center border-b border-border px-4 font-mono text-xs text-muted-foreground">{current.file}</div>
        <div className="[&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent [&>div]:mb-0">{current.panel}</div>
      </div>
    </div>
  );
}
