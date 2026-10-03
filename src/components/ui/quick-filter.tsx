"use client";

import { cn } from "@/lib/utils";

export interface QuickFilterOption<T extends string> {
    value: T;
    label: string;
    /** How many entries the filter keeps. */
    count: number;
    /** A status color as a small dot before the label, like `bg-success`. */
    dot?: string;
}

interface QuickFilterProps<T extends string> {
    value: T;
    onChange: (value: T) => void;
    options: QuickFilterOption<T>[];
    "aria-label": string;
}

/**
 * Quick filters of one list with their counts, beside its search in the toolbar of the table.
 * Tabs at the top of a page are for switching between lists of different records instead, like
 * the kinds of connections.
 */
export function QuickFilter<T extends string>({ value, onChange, options, "aria-label": label }: QuickFilterProps<T>) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            // Taller on phones, where a finger has to hit it.
                            "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-7",
                            active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {option.dot && <span className={cn("size-1.5 rounded-full", option.dot)} aria-hidden="true" />}
                        {option.label}
                        <span className="font-normal text-muted-foreground tabular-nums">{option.count}</span>
                    </button>
                );
            })}
        </div>
    );
}
