"use client";

import { CalendarDays, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { DAY_MS } from "./backup-timeline";

interface ListSwitchProps<T extends string> {
    value: T;
    onChange: (next: T) => void;
    options: { value: T; label: string }[];
    "aria-label": string;
}

/** Switches a list between two ways of showing the same backups, like by chain and all of them. */
export function ListSwitch<T extends string>({ value, onChange, options, "aria-label": label }: ListSwitchProps<T>) {
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as T)}>
            <TabsList className="h-8" aria-label={label}>
                {options.map((option) => (
                    <TabsTrigger key={option.value} value={option.value} className="px-2.5 text-xs">{option.label}</TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}

/** The day picked on the timeline, shown like an active filter of the list below it. A click removes it. */
export function DayChip({ day, count, onClear }: { day: number; count: number; onClear: () => void }) {
    const { formatDate } = useDateFormatter();
    // The middle of the day, so a time zone a few hours off still names the same date.
    const label = formatDate(new Date(day + DAY_MS / 2), "P");
    return (
        <button
            type="button"
            onClick={onClear}
            aria-label={`Only ${label}, show every day`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-xs font-medium outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-7"
        >
            <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {label}
            <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
            <X className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
    );
}
