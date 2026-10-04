"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";
import { ExpiryCell, KeyCell, keyLine, LastUsedCell, OwnerCell, StateBadge } from "./api-key-cells";

interface ColumnOptions {
    onOpen: (key: ApiKeyRow) => void;
    renderActions: (key: ApiKeyRow) => React.ReactNode;
    now: number;
}

/** The columns of the API keys. Key and actions stay put, the rest can move and hide. */
export function apiKeyColumns({ onOpen, renderActions, now }: ColumnOptions): ColumnDef<ApiKeyRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Key",
            meta: { pin: "start" },
            // The search finds a key by its name or by the start of its secret.
            filterFn: (row, _id, value: string) => {
                const query = value.trim().toLowerCase();
                return !query || row.original.name.toLowerCase().includes(query) || row.original.prefix.toLowerCase().includes(query);
            },
            cell: ({ row, table }) => <KeyCell apiKey={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
        },
        {
            id: "may",
            header: "What it may do",
            enableSorting: false,
            // A cell never wraps, so a long line is cut off here and shown in full on hover.
            cell: ({ row }) => {
                const line = keyLine(row.original);
                return <div className="max-w-md min-w-0 truncate text-sm" title={line}>{line}</div>;
            },
        },
        {
            id: "owner",
            header: "Owner",
            accessorFn: (key) => key.owner.id,
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            sortingFn: (a, b) => a.original.owner.name.localeCompare(b.original.owner.name),
            cell: ({ row }) => <div className="max-w-44"><OwnerCell apiKey={row.original} /></div>,
        },
        {
            id: "state",
            header: "State",
            accessorFn: (key) => key.state,
            cell: ({ row }) => <StateBadge apiKey={row.original} now={now} />,
        },
        {
            id: "lastUsed",
            header: "Last used",
            accessorFn: (key) => (key.lastUsedAt ? Date.parse(key.lastUsedAt) : 0),
            cell: ({ row }) => <div className="max-w-44"><LastUsedCell apiKey={row.original} /></div>,
        },
        {
            id: "expires",
            header: "Runs out",
            accessorFn: (key) => (key.expiresAt ? Date.parse(key.expiresAt) : Number.MAX_SAFE_INTEGER),
            cell: ({ row }) => <div className="max-w-36"><ExpiryCell apiKey={row.original} /></div>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}

/** The Owner filter, with only the people who own a key. */
export function apiKeyFilters(keys: ApiKeyRow[]): DataTableFilterableColumn<ApiKeyRow>[] {
    const owners = new Map(keys.map((key) => [key.owner.id, key.owner]));
    return [
        {
            id: "owner",
            title: "Owner",
            note: "The numbers count the keys",
            unavailableLabel: "No keys with the other filters",
            options: [...owners.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((owner) => ({ value: owner.id, label: owner.name, lead: <UserAvatar user={owner} size="sm" /> })),
        },
    ];
}
