"use client";

import { useId } from "react";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SetupStep } from "./setup-model";

type MarkerState = "open" | "done" | "skipped" | "todo";

/** The number of a part: quiet gray while open, a check once done, a line once skipped, an outline while to come. */
function Marker({ number, state }: { number: number; state: MarkerState }) {
    const base = "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums";
    if (state === "done" || state === "skipped") {
        const Icon = state === "done" ? Check : Minus;
        return (
            <span className={cn(base, "bg-muted", state === "done" ? "text-foreground" : "text-muted-foreground")} aria-hidden="true">
                <Icon className="size-3.5" strokeWidth={2.5} />
            </span>
        );
    }
    return (
        <span className={cn(base, state === "open" ? "bg-tone-control text-tone-control-foreground" : "border-[1.5px] border-input text-muted-foreground")} aria-hidden="true">
            {number}
        </span>
    );
}

interface OpenSectionProps {
    number: number;
    step: SetupStep;
    /** The buttons at the foot, the main one last. */
    actions: React.ReactNode;
    /** Makes the part a form, whose submit button is among the actions. */
    onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
    children: React.ReactNode;
}

/** The part being set up, in full: its question, what it offers and its buttons. */
export function OpenSection({ number, step, actions, onSubmit, children }: OpenSectionProps) {
    const titleId = useId();
    const className = "rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5";
    const content = (
        <>
            <div className="flex items-start gap-3">
                <Marker number={number} state="open" />
                <div className="min-w-0">
                    <h2 id={titleId} className="text-base font-semibold">{step.question}</h2>
                    <p className="text-sm text-muted-foreground">{step.note}</p>
                </div>
            </div>
            <div className="mt-4">{children}</div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">{actions}</div>
        </>
    );

    return onSubmit ? (
        <form aria-labelledby={titleId} noValidate onSubmit={onSubmit} className={className}>
            {content}
        </form>
    ) : (
        <section aria-labelledby={titleId} className={className}>
            {content}
        </section>
    );
}

interface DoneSectionProps {
    number: number;
    step: SetupStep;
    /** What the part made, or why there is nothing. */
    value: string;
    skipped?: boolean;
    /** Opens the part again. Left out once the job exists, since changing a part would no longer reach it. */
    onChange?: () => void;
}

/** A part done or skipped, in one line with what it made. */
export function DoneSection({ number, step, value, skipped = false, onChange }: DoneSectionProps) {
    return (
        <section aria-label={step.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-sm md:px-5">
            <Marker number={number} state={skipped ? "skipped" : "done"} />
            <span className="shrink-0 text-sm font-semibold sm:w-36">{step.title}</span>
            <span className={cn("min-w-0 flex-1 truncate text-sm", skipped && "text-muted-foreground")} title={value}>
                {value}
            </span>
            {onChange && (
                <Button type="button" variant="ghost" size="sm" onClick={onChange}>
                    Change
                </Button>
            )}
        </section>
    );
}

/** A part still to come, dashed, with what it will ask for. One reached before can be opened again. */
export function TodoSection({ number, step, onOpen }: { number: number; step: SetupStep; onOpen?: () => void }) {
    return (
        <section aria-label={step.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed px-4 py-3 md:px-5">
            <Marker number={number} state="todo" />
            <span className="shrink-0 text-sm font-semibold text-muted-foreground sm:w-36">{step.title}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{step.todo}</span>
            {onOpen && (
                <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
                    Open
                </Button>
            )}
        </section>
    );
}
