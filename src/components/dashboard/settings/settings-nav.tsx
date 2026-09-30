"use client";

import { ChevronRight, Search, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PartState } from "./settings-states";

/** A group of parts on the left of a page of settings, like System on the Settings page or You on the Profile. */
export interface NavGroup<Id extends string> {
    label: string;
    parts: { id: Id; label: string; icon: LucideIcon }[];
}

interface SearchFieldProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
}

/** The search of a page of settings, above its parts. */
export function SettingsSearchField({ value, onChange, className, placeholder = "Search settings" }: SearchFieldProps) {
    return (
        <div className={cn("relative", className)}>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
                type="search"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Escape") onChange("");
                }}
                placeholder={placeholder}
                aria-label={placeholder}
                className="h-9 w-full pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
            />
            {value && (
                <Button type="button" variant="ghost" size="icon" className="absolute top-1/2 right-0.5 size-8 -translate-y-1/2 text-muted-foreground" onClick={() => onChange("")} aria-label="Clear the search">
                    <X className="size-3.5" />
                </Button>
            )}
        </div>
    );
}

function StateText({ state }: { state: PartState }) {
    return (
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums", state.tone === "warning" ? "text-warning" : state.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>
            {state.tone && <span className={cn("size-1.5 rounded-full", state.tone === "warning" ? "bg-warning" : "bg-destructive")} aria-hidden="true" />}
            {state.text}
        </span>
    );
}

interface SettingsNavProps<Id extends string> {
    groups: NavGroup<Id>[];
    /** What the navigation is called for a screen reader, like Settings or Profile. */
    label: string;
    searchPlaceholder?: string;
    current: Id | null;
    states: Partial<Record<Id, PartState>>;
    term: string;
    onTermChange: (term: string) => void;
    /** Hits per part while searching. A part without one is dimmed. */
    counts: Partial<Record<Id, number>> | null;
    onOpen: (part: Id) => void;
}

/** The parts on the left from md up, grouped, each with its icon and its state. */
export function SettingsNav<Id extends string>({ groups, label, searchPlaceholder, current, states, term, onTermChange, counts, onOpen }: SettingsNavProps<Id>) {
    return (
        <nav aria-label={label} className="w-64 shrink-0 p-3 lg:w-72">
            <SettingsSearchField value={term} onChange={onTermChange} placeholder={searchPlaceholder} />
            {groups.map((group) => (
                <div key={group.label} className="mt-4">
                    <p className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <ul className="grid gap-0.5">
                        {group.parts.map((part) => {
                            const active = !counts && part.id === current;
                            const hits = counts?.[part.id] ?? 0;
                            const dimmed = counts !== null && hits === 0;
                            const state = states[part.id];
                            return (
                                <li key={part.id}>
                                    <button
                                        type="button"
                                        aria-current={active ? "page" : undefined}
                                        onClick={() => onOpen(part.id)}
                                        className={cn(
                                            "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                                            active ? "bg-muted font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                            dimmed && "opacity-45"
                                        )}
                                    >
                                        <part.icon className={cn("size-4 shrink-0", active && "text-foreground")} aria-hidden="true" />
                                        <span className="min-w-0 flex-1 truncate">{part.label}</span>
                                        {counts ? hits > 0 && <span className="text-xs tabular-nums text-muted-foreground">{hits}</span> : state && <StateText state={state} />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );
}

interface PhoneListProps<Id extends string> {
    groups: NavGroup<Id>[];
    states: Partial<Record<Id, PartState>>;
    onOpen: (part: Id) => void;
}

/** The parts on a phone: a list per group, each part with its state, which opens as a page of its own. */
export function SettingsPhoneList<Id extends string>({ groups, states, onOpen }: PhoneListProps<Id>) {
    return (
        <div className="space-y-4">
            {groups.map((group) => (
                <div key={group.label}>
                    <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
                        {group.parts.map((part) => {
                            const state = states[part.id];
                            return (
                                <li key={part.id}>
                                    <button type="button" onClick={() => onOpen(part.id)} className="flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-2 text-left outline-none focus-visible:bg-muted/50 active:bg-muted/50">
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                            <part.icon className="size-4 text-muted-foreground" />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{part.label}</span>
                                        {state && <StateText state={state} />}
                                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
