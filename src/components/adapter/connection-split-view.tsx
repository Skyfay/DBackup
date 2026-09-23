"use client";

import { useRef } from "react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AdapterConfig } from "./types";
import { healthOf } from "./connection-columns";
import { connectionAddress } from "./connection-summary";
import { resolveSelection, splitGroups } from "./connection-split";

const DOTS = { ONLINE: "bg-success", DEGRADED: "bg-warning", OFFLINE: "bg-destructive", PENDING: "bg-muted-foreground/40" };
const LABELS = { ONLINE: "Online", DEGRADED: "Degraded", OFFLINE: "Offline", PENDING: "Not checked" };

interface ConnectionSplitViewProps {
    /** The connections after search and filters, in table order. */
    configs: AdapterConfig[];
    /** Notification channels have no health checks, so their list has no dots and no headings. */
    withHealth: boolean;
    selectedId: string | null;
    onSelect: (id: string) => void;
    renderPanel: (config: AdapterConfig) => React.ReactNode;
    /** The right click menu of one entry, as a `ContextMenuContent`. */
    renderMenu?: (config: AdapterConfig) => React.ReactNode;
}

function subline(config: AdapterConfig): string {
    const address = connectionAddress(config.adapterId, config.config) ?? "";
    const used = config.overview?.usedBy;
    const unused = used !== undefined && used.jobs + used.templates === 0;
    return unused ? ["Not used", address].filter(Boolean).join(" · ") : address;
}

/**
 * A slim list beside the details of the picked connection. The arrow keys move through the
 * list, so going over every connection needs no clicks.
 */
export function ConnectionSplitView({ configs, withHealth, selectedId, onSelect, renderPanel, renderMenu }: ConnectionSplitViewProps) {
    const buttons = useRef(new Map<string, HTMLButtonElement>());
    const groups = splitGroups(configs, withHealth);
    const selected = resolveSelection(groups, selectedId);
    const ordered = groups.flatMap((group) => group.items);

    const moveWithKeys = (event: React.KeyboardEvent, index: number) => {
        const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        const next = ordered[index + step];
        if (step === 0 || !next) return;
        event.preventDefault();
        onSelect(next.id);
        buttons.current.get(next.id)?.focus();
    };

    return (
        // A fixed height on larger screens, so the list and the details scroll on their own.
        <div className="grid gap-4 md:h-[calc(100dvh-15rem)] md:min-h-128 md:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="flex max-h-96 min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm md:max-h-none">
                {/* Radix wraps the list in a `display: table` div that grows with its longest line, which
                    would stop the names and addresses from being cut off. Block keeps it at the list's width. */}
                <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                    {ordered.length === 0 ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">No results.</p>
                    ) : (
                        <div className="space-y-2 p-2">
                            {groups.map((group) => (
                                <div key={group.label ?? "all"}>
                                    {group.label && (
                                        <div className="flex items-center justify-between px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                                            <span>{group.label}</span>
                                            <span className="tabular-nums">{group.items.length}</span>
                                        </div>
                                    )}
                                    <ul className="space-y-0.5">
                                        {group.items.map((config) => {
                                            const active = config.id === selected?.id;
                                            const health = healthOf(config);
                                            const entry = (
                                                <button
                                                        type="button"
                                                        ref={(node) => {
                                                            if (node) buttons.current.set(config.id, node);
                                                            else buttons.current.delete(config.id);
                                                        }}
                                                        aria-pressed={active}
                                                        onClick={() => onSelect(config.id)}
                                                        onKeyDown={(event) => moveWithKeys(event, ordered.indexOf(config))}
                                                        className={cn(
                                                            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                                            active ? "bg-muted" : "hover:bg-muted/50 data-[state=open]:bg-muted/50"
                                                        )}
                                                    >
                                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                                            <AdapterIcon adapterId={config.adapterId} className="size-4" />
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-medium">{config.name}</span>
                                                            <span className="block truncate text-xs text-muted-foreground">{subline(config)}</span>
                                                        </span>
                                                        {withHealth && (
                                                            <span className={cn("size-2 shrink-0 rounded-full", DOTS[health])}>
                                                                <span className="sr-only">{LABELS[health]}</span>
                                                            </span>
                                                        )}
                                                </button>
                                            );
                                            const menu = renderMenu?.(config);
                                            return (
                                                <li key={config.id}>
                                                    {menu ? (
                                                        <ContextMenu>
                                                            <ContextMenuTrigger asChild>{entry}</ContextMenuTrigger>
                                                            {menu}
                                                        </ContextMenu>
                                                    ) : (
                                                        entry
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            <div className="flex min-h-112 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm md:min-h-0">
                {selected ? (
                    renderPanel(selected)
                ) : (
                    <p className="m-auto p-6 text-sm text-muted-foreground">Nothing to show for this filter.</p>
                )}
            </div>
        </div>
    );
}
