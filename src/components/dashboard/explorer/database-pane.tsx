"use client";

import { Lock, Search, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/ui/refresh-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * The parts of the two panes of a database page, the list on the left and the rows beside it.
 * From `lg` a pane fills the height of the page and scrolls inside, on smaller screens its list
 * stops at a height and the page scrolls.
 */

/** A pane, a card that fills the height of the page from `lg`. */
export const PANE = "flex min-w-0 flex-col rounded-xl border bg-card shadow-sm lg:h-full lg:min-h-0";

/**
 * What stands where the tables or the rows would when the server does not hand them out. It is
 * the login of the connection that decides, and the backups do not depend on it.
 */
export function ClosedNote({ title, children, message }: { title: string; children: React.ReactNode; message?: string | null }) {
    return (
        <div className="flex gap-3 rounded-lg border bg-muted/30 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                <Lock className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground">{children}</p>
                {message && <p className="rounded-md border bg-card px-2.5 py-1.5 font-mono text-xs break-all text-muted-foreground">{message}</p>}
            </div>
        </div>
    );
}

/** What a pane scrolls, filling the rest of it from `lg` and stopping at a height below. */
export function PaneScroll({ horizontal = false, className, children }: { horizontal?: boolean; className?: string; children: React.ReactNode }) {
    return (
        <ScrollArea
            horizontal={horizontal}
            className={cn("lg:min-h-0 lg:flex-1 *:data-[slot=scroll-area-viewport]:max-h-[28rem] lg:*:data-[slot=scroll-area-viewport]:max-h-none", className)}
        >
            {children}
        </ScrollArea>
    );
}

/** The head of a list pane with its title, a line under it and a button that lists it again. */
export function PaneHead({ title, sub, refreshLabel, busy, onRefresh }: { title: string; sub: string; refreshLabel: string; busy: boolean; onRefresh: () => void }) {
    return (
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1">
                <p className="font-semibold">{title}</p>
                <p className="truncate text-sm text-muted-foreground">{sub}</p>
            </div>
            <RefreshButton onRefresh={onRefresh} busy={busy} label={refreshLabel} className="size-8" />
        </div>
    );
}

export function PaneSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return (
        <div className="relative px-4 pb-2">
            <Search className="pointer-events-none absolute top-1/2 left-6.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 pl-8" />
        </div>
    );
}

/** An entry of a list pane, which a click shows beside. */
export function PaneRow({ icon: Icon, name, sub, aside, picked, onPick }: {
    icon: LucideIcon;
    name: string;
    sub: string;
    aside?: React.ReactNode;
    picked: boolean;
    onPick: () => void;
}) {
    return (
        <li>
            <button
                type="button"
                onClick={onPick}
                aria-pressed={picked}
                className={cn(
                    "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                    picked && "bg-muted hover:bg-muted"
                )}
            >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", picked && "font-medium")}>{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                </span>
                {aside}
            </button>
        </li>
    );
}

/** Where the rows would be before an entry of the list is picked. */
export function PanePrompt({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed px-4 text-center text-sm text-muted-foreground lg:h-full">
            <p className="max-w-sm">{children}</p>
        </div>
    );
}
