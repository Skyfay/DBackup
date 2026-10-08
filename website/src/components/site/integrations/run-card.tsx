"use client";

import { useRef } from "react";
import { CircleCheck, Lock } from "lucide-react";
import { useTick } from "@/components/site/home/use-tick";
import { cn } from "@/lib/utils";

export interface RunStep {
  name: string;
  detail: string;
  /** The detail is a command and shows in the mono font. */
  command?: boolean;
  /** What the step shows once it is done. */
  result: string;
}

/**
 * A nightly run of a job, the steps finishing one after the other and
 * starting again. With reduced motion it shows the finished run.
 */
export function RunCard({
  job,
  schedule,
  steps,
  running,
  finished,
  note,
}: {
  job: string;
  schedule: string;
  steps: RunStep[];
  running: string;
  finished: string;
  note: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A few ticks of rest on the finished run before it starts again.
  const tick = useTick(1100, ref, steps.length);
  const phase = Math.min(tick % (steps.length + 4), steps.length);
  const done = phase >= steps.length;

  return (
    <div
      ref={ref}
      className="dark relative min-w-0 overflow-hidden rounded-[20px] border border-border-strong bg-[#111113] text-foreground shadow-[0_60px_120px_-40px_rgb(37_99_235/0.45),inset_0_1px_0_rgb(255_255_255/0.05)]"
    >
      <div className="flex h-12 items-center gap-2.5 border-b border-border bg-surface px-4">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#3f3f46]" />
          <span className="size-2.5 rounded-full bg-[#3f3f46]" />
          <span className="size-2.5 rounded-full bg-[#3f3f46]" />
        </span>
        <span className="text-[13px] font-medium">{job}</span>
        <span className="hidden text-[13px] text-faint sm:inline">{schedule}</span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
            done ? "bg-tone-green/14 text-tone-green" : "bg-tone-blue/14 text-tone-blue-soft"
          )}
        >
          {done ? finished : running}
        </span>
      </div>
      <ol className="flex flex-col gap-1 p-2.5">
        {steps.map((step, i) => {
          const isDone = i < phase;
          const isRunning = i === phase;
          return (
            <li
              key={step.name}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 transition-colors duration-300",
                isRunning && "bg-tone-blue/8",
                !isDone && !isRunning && "text-faint"
              )}
            >
              <span aria-hidden="true" className="flex size-[22px] shrink-0 items-center justify-center">
                {isDone ? (
                  <CircleCheck className="size-[18px] text-tone-green" />
                ) : isRunning ? (
                  <span className="size-3.5 animate-spin rounded-full border-2 border-tone-blue/25 border-t-tone-blue" />
                ) : (
                  <span className="size-2 rounded-full bg-[#3f3f46]" />
                )}
              </span>
              <span className="min-w-[74px] shrink-0 font-medium whitespace-nowrap">{step.name}</span>
              <span
                className={cn(
                  "min-w-0 truncate",
                  step.command ? "font-mono text-xs" : "text-[13px]",
                  isDone || isRunning ? "text-muted-foreground" : "text-fainter"
                )}
              >
                {step.detail}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{isDone ? step.result : ""}</span>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2.5 border-t border-border px-4 py-3 text-xs text-faint">
        <Lock aria-hidden="true" className="size-3.5 shrink-0" />
        {note}
      </div>
    </div>
  );
}
