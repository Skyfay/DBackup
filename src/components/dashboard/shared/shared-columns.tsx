"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Database, History } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { BackupFlags, IntegrityBadge, MadeAt } from "@/components/dashboard/storage/explorer/explorer-cells";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { cn, formatBytes } from "@/lib/utils";
import type { SharedDatabase, SharedPlace } from "@/services/tenant/shared-databases";
import { databaseOptions, formerLabel, isFormer, madeAt, madeAtText, serverOptions, sharedKey, stateOf, type SharedRow } from "./shared-model";

/** The id of the column the search of the list reads, the database and its server. */
export const SHARED_SEARCH = "search";

interface ColumnOptions {
    onOpen: (row: SharedRow) => void;
    renderActions: (row: SharedRow) => React.ReactNode;
}

/** The last check of a backup in the shape of the badge of the Backups tab. */
export const checkOf = (row: Pick<SharedRow, "verification">) =>
    // The badge reads whether it passed, the trigger only matters for the panel of an own backup.
    row.verification ? { verifiedAt: row.verification.at, passed: row.verification.passed, trigger: "scheduled" as const } : undefined;

/** A small tag beside a database that is no longer the tenant's, or whose server was deleted. */
export function FormerTag({ label = "Former" }: { label?: string }) {
    return <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">{label}</span>;
}

/** Who runs the server and its backups, as a quiet chip like a copy on the Backups tab. */
export function ProviderChip({ name }: { name: string }) {
    return (
        <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}

/**
 * The database of a backup with the logo of its engine, dimmed and tagged when it is no longer the
 * tenant's. A backup made before the database moved says where it was made.
 */
export function DatabaseCell({ database, made = null }: { database: SharedDatabase; made?: SharedPlace | null }) {
    const former = isFormer(database);
    return (
        <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                <AdapterIcon adapterId={database.adapterId} className="size-4" />
            </span>
            <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("truncate text-sm font-medium", former && "text-muted-foreground")}>{database.databaseName}</span>
                    {former && <FormerTag label={formerLabel(database)} />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{made ? madeAtText(made, database.databaseName) : kindNames.get(database.adapterId) ?? database.adapterId}</span>
            </span>
        </span>
    );
}

/** The size of the dump of the one database, never of the archive around it. */
export function DumpSizeCell({ row }: { row: Pick<SharedRow, "dump"> }) {
    if (!row.dump) return <div className="text-right text-sm text-muted-foreground" title="Not read from the backup yet">-</div>;
    return (
        <div className="text-right tabular-nums">
            <div className="text-sm font-medium">{formatBytes(row.dump.stored)}</div>
            {row.dump.unpacked > row.dump.stored && <div className="text-xs text-muted-foreground">{formatBytes(row.dump.unpacked)} unpacked</div>}
        </div>
    );
}

const includes = (value: string[], cell: unknown) => value.includes(String(cell));

/** The columns of the backups shared with the tenant. The Columns menu decides which of them show. */
export function sharedColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<SharedRow>[] {
    return [
        {
            id: "backup",
            accessorFn: (row) => row.createdAt,
            header: "Backup",
            sortingFn: (a, b) => a.original.createdAt.localeCompare(b.original.createdAt),
            meta: { label: "Backup", pin: "start" },
            cell: ({ row }) => (
                <button type="button" onClick={() => onOpen(row.original)} className="min-w-0 text-left outline-none focus-visible:underline">
                    <MadeAt file={{ createdAt: row.original.createdAt, lastModified: row.original.createdAt }} />
                </button>
            ),
        },
        {
            id: "database",
            accessorFn: (row) => sharedKey(row.database),
            header: "Database",
            sortingFn: (a, b) => a.original.database.databaseName.localeCompare(b.original.database.databaseName),
            filterFn: (row, id, value: string[]) => includes(value, row.getValue(id)),
            meta: { label: "Database" },
            cell: ({ row }) => <DatabaseCell database={row.original.database} made={madeAt(row.original)} />,
        },
        {
            id: "server",
            accessorFn: (row) => row.database.sourceId,
            header: "Server",
            sortingFn: (a, b) => a.original.database.serverName.localeCompare(b.original.database.serverName),
            filterFn: (row, id, value: string[]) => includes(value, row.getValue(id)),
            meta: { label: "Server" },
            cell: ({ row }) => <span className="block max-w-48 truncate text-sm">{row.original.database.serverName}</span>,
        },
        {
            id: "provider",
            header: "Provided by",
            enableSorting: false,
            meta: { label: "Provided by" },
            cell: ({ row }) => <ProviderChip name={row.original.database.providerName} />,
        },
        {
            id: "size",
            accessorFn: (row) => row.dump?.stored ?? -1,
            header: () => <div className="text-right">Size</div>,
            meta: { label: "Size" },
            cell: ({ row }) => <DumpSizeCell row={row.original} />,
        },
        {
            id: "integrity",
            header: "Integrity",
            enableSorting: false,
            meta: { label: "Integrity" },
            cell: ({ row }) => <IntegrityBadge verification={checkOf(row.original)} />,
        },
        {
            id: "flags",
            header: "",
            enableSorting: false,
            meta: { label: "Encrypted" },
            cell: ({ row }) => <BackupFlags file={{ locked: false, isEncrypted: row.original.encrypted }} />,
        },
        {
            id: "actions",
            header: "",
            enableSorting: false,
            meta: { pin: "end", label: "Actions" },
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
        {
            id: "state",
            accessorFn: stateOf,
            header: "State",
            filterFn: (row, id, value: string[]) => includes(value, row.getValue(id)),
            meta: { label: "State", filterOnly: true },
        },
        {
            id: SHARED_SEARCH,
            accessorFn: (row) => `${row.database.databaseName} ${row.databaseName} ${row.database.serverName}`,
            header: "Search",
            meta: { label: "Search", filterOnly: true },
        },
    ];
}

const UNAVAILABLE = "No backups with the other filters";

/** The filters of the list: the database, the server while there are several, and whether it is still the tenant's. */
export function sharedFilters(databases: readonly SharedDatabase[]): DataTableFilterableColumn<SharedRow>[] {
    const servers = serverOptions(databases);
    const filters: DataTableFilterableColumn<SharedRow>[] = [{
        id: "database",
        title: "Database",
        note: "The numbers count the backups",
        unavailableLabel: UNAVAILABLE,
        options: databaseOptions(databases).map((option) => ({ ...option, icon: Database })),
    }];
    if (servers.length > 1) {
        filters.push({ id: "server", title: "Server", note: "The numbers count the backups", unavailableLabel: UNAVAILABLE, options: servers.map((option) => ({ ...option, icon: Database })) });
    }
    if (databases.some(isFormer)) {
        filters.push({
            id: "state",
            title: "State",
            note: "The numbers count the backups",
            unavailableLabel: UNAVAILABLE,
            options: [
                { value: "current", label: "Yours now", icon: Database },
                { value: "former", label: "Former, download only", icon: History },
            ],
        });
    }
    return filters;
}
