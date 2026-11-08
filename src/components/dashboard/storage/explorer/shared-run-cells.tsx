"use client";

import { Building2, Clock, Play } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { FormerTag } from "@/components/dashboard/shared/shared-cells";
import { formerLabel, isFormer, madeAt, madeAtText, starterOf, type SharedRow } from "@/components/dashboard/shared/shared-model";
import { cn } from "@/lib/utils";

/**
 * The cells of a backup of a database another tenant's server gives to this one, in the list of
 * every backup. They name the database, its server and its provider, never a destination of theirs.
 */

/** The small tag beside the name of a shared database. */
export function SharedTag() {
    return (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
            <Building2 className="size-3" aria-hidden="true" />
            Shared
        </span>
    );
}

/** The logo of the engine of a shared database in the tile of a job. */
export function SharedTile({ adapterId, size = "sm" }: { adapterId: string; size?: "sm" | "md" }) {
    return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg border bg-muted/50", size === "md" ? "size-8" : "size-7")} aria-hidden="true">
            <AdapterIcon adapterId={adapterId} className="size-4" />
        </span>
    );
}

/** Where a shared backup comes from: its server and its provider, or where it was made before the database moved. */
export function sharedOrigin(row: Pick<SharedRow, "database" | "sourceId" | "databaseName">): string {
    const made = madeAt(row);
    return `${made ? madeAtText(made, row.database.databaseName) : row.database.serverName} · ${row.database.providerName}`;
}

/** The job of a shared backup: its database with a tag, and its server and provider under it. */
export function SharedJobCell({ row }: { row: SharedRow }) {
    const { database } = row;
    const former = isFormer(database);
    return (
        <span className="flex min-w-0 items-center gap-2.5">
            <SharedTile adapterId={database.adapterId} />
            <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("truncate text-sm font-medium", former && "text-muted-foreground")}>{database.databaseName}</span>
                    {former ? <FormerTag label={formerLabel(database)} /> : <SharedTag />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{sharedOrigin(row)}</span>
            </span>
        </span>
    );
}

/** The type of a shared backup, the dump of one database. */
export function SharedTypeChip() {
    return <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium whitespace-nowrap">Database</span>;
}

/** Who started a shared backup: the schedule of its provider, or Back up now of someone of the tenant. */
export function SharedStartedBy({ row }: { row: Pick<SharedRow, "requestedBy" | "database"> }) {
    const starter = starterOf(row);
    const Icon = starter.kind === "request" ? Play : Clock;
    return (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">
                {starter.label}
                <span className="text-muted-foreground"> · {starter.who}</span>
            </span>
        </span>
    );
}
