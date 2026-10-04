"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { SsoProviderRow } from "@/services/sso/sso-providers-types";
import { LastSignInCell, LinkedFaces, NewPeopleCell, PlaceCell, ProviderCell, ProviderStateBadge } from "./sign-in-cells";

interface ColumnOptions {
    onOpen: (provider: SsoProviderRow) => void;
    renderActions: (provider: SsoProviderRow) => React.ReactNode;
}

/** The columns of the sign-in providers. Provider and actions stay put, the rest can move and hide. */
export function signInColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<SsoProviderRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Provider",
            meta: { pin: "start" },
            // The search finds a provider by its name, its ID or where it signs in.
            filterFn: (row, _id, value: string) => {
                const query = value.trim().toLowerCase();
                const { name, providerId, host } = row.original;
                return !query || [name, providerId, host ?? ""].some((field) => field.toLowerCase().includes(query));
            },
            cell: ({ row, table }) => <ProviderCell provider={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
        },
        {
            id: "place",
            header: "Signs in at",
            accessorFn: (provider) => provider.host ?? "",
            cell: ({ row }) => <div className="max-w-56"><PlaceCell provider={row.original} /></div>,
        },
        {
            id: "linked",
            header: "Linked",
            accessorFn: (provider) => provider.linked.length,
            cell: ({ row }) => <LinkedFaces people={row.original.linked} />,
        },
        {
            id: "lastSignIn",
            header: "Last sign-in",
            accessorFn: (provider) => (provider.lastSignIn ? Date.parse(provider.lastSignIn.at) : 0),
            cell: ({ row }) => <div className="max-w-44"><LastSignInCell provider={row.original} /></div>,
        },
        {
            id: "newPeople",
            header: "New people",
            enableSorting: false,
            cell: ({ row }) => <div className="max-w-60"><NewPeopleCell provider={row.original} /></div>,
        },
        {
            id: "state",
            header: "State",
            accessorFn: (provider) => (provider.enabled ? 1 : 0),
            cell: ({ row }) => <ProviderStateBadge provider={row.original} />,
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
