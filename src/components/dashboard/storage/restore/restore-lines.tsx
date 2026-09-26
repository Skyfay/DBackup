"use client";

import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OutcomeTone } from "./restore-parts";

/** One line of the lines view: what comes back on the left, where it goes on the right. */
export interface Line {
    key: string;
    /** The color of the line, none for what stays out. */
    tone: OutcomeTone | null;
    dashed?: boolean;
    /** Thicker for a bundle of many. */
    weight?: number;
    label: string;
    left: React.ReactNode;
    right: React.ReactNode;
    /** A bundle of several, drawn as a small stack of cards. */
    stacked?: boolean;
    dim?: boolean;
    /** Opens the rows of this line in the table. */
    onOpen?: () => void;
}

const LINE = { warning: "border-warning", success: "border-success", muted: "border-muted-foreground/50" } as const;
const DOT = { warning: "bg-warning", success: "bg-success", muted: "bg-muted-foreground/60" } as const;
const TEXT = { warning: "border-warning/40 text-warning", success: "border-success/40 text-success", muted: "border-border text-muted-foreground" } as const;
const TARGET = {
    warning: "border-warning/40 bg-warning/5",
    success: "border-dashed border-success/50 bg-success/5",
    muted: "border-border",
} as const;
// Two cards peeking out behind a bundle, drawn with the colors of the card and its border.
const STACK = "shadow-[3px_3px_0_-1px_var(--card),3px_3px_0_0_var(--border),6px_6px_0_-1px_var(--card),6px_6px_0_0_var(--border)]";

function Block({ className, stacked, onOpen, children }: { className?: string; stacked?: boolean; onOpen?: () => void; children: React.ReactNode }) {
    const classes = cn("min-w-0 rounded-xl border p-3 text-left", stacked && STACK, className);
    if (!onOpen) return <div className={classes}>{children}</div>;
    return (
        <button type="button" onClick={onOpen} className={cn(classes, "outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50")}>
            {children}
        </button>
    );
}

function LineRow({ line }: { line: Line }) {
    const tone = line.tone;
    return (
        <div className={cn("grid items-center gap-1 md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.6fr)_minmax(0,1fr)] md:gap-0", line.dim && "opacity-60")}>
            <Block className="bg-card" stacked={line.stacked} onOpen={line.onOpen}>
                {line.left}
            </Block>
            <div className="relative flex min-h-9 items-center justify-center self-stretch">
                {tone && (
                    <>
                        {/* The line itself is computed from the size of the bundle, so its width is a style. */}
                        <span className={cn("absolute inset-x-0 top-1/2 hidden -translate-y-1/2 md:block", LINE[tone], line.dashed ? "border-dashed" : "border-solid")} style={{ borderTopWidth: line.weight ?? 2.5 }} aria-hidden="true" />
                        <span className={cn("absolute top-1/2 left-0 hidden size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-3 ring-card md:block", DOT[tone])} aria-hidden="true" />
                        <span className={cn("absolute top-1/2 right-0 hidden size-3 translate-x-1/2 -translate-y-1/2 rounded-full ring-3 ring-card md:block", DOT[tone])} aria-hidden="true" />
                    </>
                )}
                <span className={cn("relative inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2.5 text-xs font-semibold whitespace-nowrap", tone ? TEXT[tone] : TEXT.muted)}>
                    <ArrowDown className="size-3 md:hidden" aria-hidden="true" />
                    {line.label}
                </span>
            </div>
            <Block className={cn(tone ? TARGET[tone] : "border-dashed")} stacked={line.stacked}>
                {line.right}
            </Block>
        </div>
    );
}

/** What comes back on the left, where it goes on the right, and a line between them for each. */
export function LinesView({ lines, foot }: { lines: Line[]; foot?: React.ReactNode }) {
    return (
        <div className="space-y-3 md:space-y-4">
            {lines.map((line) => (
                <LineRow key={line.key} line={line} />
            ))}
            {foot && <p className="text-xs text-muted-foreground md:text-right">{foot}</p>}
        </div>
    );
}

/** A few names as small chips, the rest counted. */
export function NameChips({ names, max = 4 }: { names: string[]; max?: number }) {
    return (
        <span className="mt-2 flex flex-wrap items-center gap-1">
            {names.slice(0, max).map((name) => (
                <span key={name} className="max-w-40 truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                    {name}
                </span>
            ))}
            {names.length > max && <span className="text-[11px] text-muted-foreground">+{names.length - max} more</span>}
        </span>
    );
}
