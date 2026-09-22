"use client";

import { flexRender, type Row } from "@tanstack/react-table";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { isPlainClick } from "@/components/ui/row-click";
import { cn } from "@/lib/utils";
import type { AdapterConfig } from "./types";
import { kindNames } from "./connection-columns";
import { connectionVersion } from "./connection-summary";

/** Columns a card draws in their own place rather than in the row of values. */
const PLACED = new Set(["select", "name", "status", "address", "health", "actions"]);
/** Values fit three abreast, more would crowd the card. */
const VALUES_SHOWN = 3;

const BUCKETS = { ok: "bg-success", failed: "bg-warning", offline: "bg-destructive", none: "bg-muted" } as const;

interface ConnectionCardProps {
    row: Row<AdapterConfig>;
    onOpen: (config: AdapterConfig) => void;
}

/**
 * One connection as a card. It renders the table's own cells, so the Columns menu decides
 * what a card shows: the status, the address and the first three other visible columns,
 * plus the health strip while its column is on.
 */
export function ConnectionCard({ row, onOpen }: ConnectionCardProps) {
    const config = row.original;
    const cells = row.getVisibleCells();
    const byId = new Map(cells.map((cell) => [cell.column.id, cell]));
    const render = (id: string) => {
        const cell = byId.get(id);
        return cell ? flexRender(cell.column.columnDef.cell, cell.getContext()) : null;
    };
    const values = cells.filter((cell) => !PLACED.has(cell.column.id)).slice(0, VALUES_SHOWN);
    const version = connectionVersion(config.metadata);
    const overview = config.overview;

    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(config)}
            className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                    <AdapterIcon adapterId={config.adapterId} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(config)}
                        className="block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {config.name}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                        {kindNames.get(config.adapterId) ?? config.adapterId}
                        {version && ` ${version}`}
                    </p>
                </div>
                <div className="-mt-1 -mr-2">{render("actions")}</div>
            </div>

            {(byId.has("status") || byId.has("address")) && (
                <div className="min-w-0 space-y-1">
                    {byId.has("status") && <div>{render("status")}</div>}
                    {byId.has("address") && <div className="min-w-0 text-muted-foreground">{render("address")}</div>}
                </div>
            )}

            {values.length > 0 && (
                <dl className={cn("grid gap-3 border-t pt-3", values.length === 1 ? "grid-cols-1" : values.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
                    {values.map((cell) => (
                        <div key={cell.column.id} className="min-w-0">
                            <dt className="truncate text-xs text-muted-foreground">
                                {cell.column.columnDef.meta?.label ?? String(cell.column.columnDef.header)}
                            </dt>
                            <dd className="mt-1 min-w-0 truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</dd>
                        </div>
                    ))}
                </dl>
            )}

            {byId.has("health") && overview && overview.checksPassed !== null && (
                <div>
                    <div className="flex h-3 items-stretch gap-0.5" aria-hidden="true">
                        {overview.health.map((bucket, hour) => (
                            <span key={hour} className={cn("flex-1 rounded-xs", BUCKETS[bucket])} />
                        ))}
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                        <span>Health, last 24 hours</span>
                        <span className="tabular-nums">{overview.checksPassed}% passed</span>
                    </div>
                </div>
            )}
        </div>
    );
}
