"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { VaultKey } from "@/services/vault/vault-types";
import { JobStack, KeyIdText, KeyTile, KitCell } from "./vault-cells";
import { count } from "./vault-format";

/** Tile, name and description, the button in it opens the details for keyboards. */
function KeyCell({ keyRow, compact, onOpen }: { keyRow: VaultKey; compact: boolean; onOpen: (key: VaultKey) => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <KeyTile size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-72", compact && "flex items-baseline gap-2")}>
                <button
                    type="button"
                    onClick={() => onOpen(keyRow)}
                    title={keyRow.name}
                    className={cn("block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50", compact && "shrink-0")}
                >
                    {keyRow.name}
                </button>
                {keyRow.description && <div className="min-w-0 truncate text-xs text-muted-foreground">{keyRow.description}</div>}
            </div>
        </div>
    );
}

/** How many backups a key opens, and at how many destinations they lie. */
export function ProtectsCell({ keyRow }: { keyRow: VaultKey }) {
    if (keyRow.backups === 0) return <span className="text-sm text-muted-foreground">no backup</span>;
    return (
        <div className="min-w-0 text-sm">
            <div className="tabular-nums whitespace-nowrap">{count(keyRow.backups, "backup")}</div>
            <div className="truncate text-xs text-muted-foreground">at {count(keyRow.destinations.length, "destination")}</div>
        </div>
    );
}

interface ColumnOptions {
    onOpen: (key: VaultKey) => void;
    renderActions: (key: VaultKey) => React.ReactNode;
}

/** The columns of the encryption keys. Name and actions stay put, the rest can move and hide. */
export function keyColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<VaultKey>[] {
    return [
        {
            accessorKey: "name",
            header: "Key",
            meta: { pin: "start" },
            cell: ({ row, table }) => <KeyCell keyRow={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
        },
        {
            id: "keyId",
            header: "Key ID",
            cell: ({ row }) => <KeyIdText keyId={row.original.keyId} className="whitespace-nowrap" />,
        },
        {
            id: "encrypts",
            header: "Encrypts",
            cell: ({ row }) => <JobStack jobs={row.original.jobs} configBackup={row.original.configBackup} className="max-w-72" />,
        },
        {
            id: "protects",
            header: "Protects",
            cell: ({ row }) => <ProtectsCell keyRow={row.original} />,
        },
        {
            id: "kit",
            header: "Recovery kit",
            cell: ({ row }) => <KitCell kit={row.original.kit} />,
        },
        {
            id: "created",
            header: "Created",
            cell: ({ row }) => <span className="text-sm whitespace-nowrap text-muted-foreground"><DateDisplay date={row.original.createdAt} format="P" /></span>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}
