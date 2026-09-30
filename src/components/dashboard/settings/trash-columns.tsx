"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArchiveRestore, CalendarClock, HardDrive, KeyRound, Lock, Trash2, UserRound, type LucideIcon } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TrashKind, TrashRow } from "@/services/trash/trash-types";

/** What each kind of deleted record is called and drawn with. */
export const TRASH_KIND_INFO: Record<TrashKind, { label: string; plural: string; icon: LucideIcon }> = {
    encryptionKey: { label: "Key", plural: "Keys", icon: KeyRound },
    credential: { label: "Saved login", plural: "Saved logins", icon: Lock },
    connection: { label: "Connection", plural: "Connections", icon: HardDrive },
    job: { label: "Job", plural: "Jobs", icon: CalendarClock },
    user: { label: "User", plural: "Users", icon: UserRound },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until Clean old data removes it, 0 once its time is up. */
export function daysLeft(row: Pick<TrashRow, "expiresAt">, now = Date.now()): number {
    return Math.max(0, Math.ceil((Date.parse(row.expiresAt) - now) / DAY_MS));
}

/** Soon gone, in amber like everything else that needs a look. */
export const SOON_DAYS = 3;

export function TrashTile({ kind, className }: { kind: TrashKind; className?: string }) {
    const Icon = TRASH_KIND_INFO[kind].icon;
    return (
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50", className)} aria-hidden="true">
            <Icon className="size-4 text-muted-foreground" />
        </span>
    );
}

function GoneCell({ row }: { row: TrashRow }) {
    const days = daysLeft(row);
    const soon = days <= SOON_DAYS;
    return (
        <span className={cn("flex items-center gap-1.5 text-sm whitespace-nowrap", soon && "text-warning")}>
            {soon && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />}
            {days === 0 ? "at the next cleanup" : days === 1 ? "in 1 day" : `in ${days} days`}
        </span>
    );
}

export interface TrashHandlers {
    onRestore: (row: TrashRow) => void;
    onPurge: (row: TrashRow) => void;
}

/** What a deleted record can have done to it, for the button at the end of its row and the right click. */
export function trashActions(row: TrashRow, handlers: TrashHandlers): BackupActionGroup[] {
    return [
        { actions: [{ id: "restore", label: "Restore", icon: ArchiveRestore, onSelect: () => handlers.onRestore(row), tone: "create" }] },
        { actions: [{ id: "purge", label: "Delete permanently", icon: Trash2, onSelect: () => handlers.onPurge(row), tone: "destructive" }] },
    ];
}

/** The columns of Recently deleted. */
export function trashColumns(renderActions: (row: TrashRow) => React.ReactNode): ColumnDef<TrashRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Deleted item",
            filterFn: (row, _id, value: string) => {
                const query = value.trim().toLowerCase();
                return !query || `${row.original.name} ${row.original.detail ?? ""}`.toLowerCase().includes(query);
            },
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <TrashTile kind={row.original.kind} />
                    <div className="min-w-0 max-w-md">
                        <p className="truncate text-sm font-medium">{row.original.name}</p>
                        {row.original.detail && <p className="truncate text-xs text-muted-foreground" title={row.original.detail}>{row.original.detail}</p>}
                    </div>
                </div>
            ),
        },
        {
            accessorKey: "kind",
            header: "Kind",
            cell: ({ row }) => <Badge variant="outline">{TRASH_KIND_INFO[row.original.kind].label}</Badge>,
        },
        {
            id: "deletedAt",
            header: "Deleted",
            accessorFn: (row) => Date.parse(row.deletedAt),
            cell: ({ row }) => (
                <div className="w-36 min-w-0">
                    <RelativeTime date={row.original.deletedAt} className="block text-sm" />
                    {row.original.deletedByName && <p className="truncate text-xs text-muted-foreground">by {row.original.deletedByName}</p>}
                </div>
            ),
        },
        {
            id: "gone",
            header: "Gone",
            accessorFn: (row) => Date.parse(row.expiresAt),
            cell: ({ row }) => <GoneCell row={row.original} />,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableSorting: false,
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end gap-0.5">{renderActions(row.original)}</div>,
        },
    ];
}
