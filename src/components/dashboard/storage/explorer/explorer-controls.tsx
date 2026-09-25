"use client";

import { CalendarDays, X } from "lucide-react";

/** What a timeline picked for the list below it, shown like an active filter of that list. A click removes it. */
export function PickChip({ label, count, onClear }: { label: string; count: number; onClear: () => void }) {
    return (
        <button
            type="button"
            onClick={onClear}
            aria-label={`Only ${label}, show them all`}
            className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-xs font-medium outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-7"
        >
            <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{label}</span>
            <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
            <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
    );
}
