"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import type { AuditRow } from "@/services/audit/audit-types";
import { FromCell, WhatCell, WhenCell, WhoCell } from "./audit-cells";

/** The columns of the entries. The server sorts and filters, so no column sorts on its own. */
export function auditColumns({ now }: { now: number }): ColumnDef<AuditRow>[] {
    return [
        { id: "when", accessorFn: (row) => row.at, header: "When", enableSorting: false, meta: { pin: "start" }, cell: ({ row }) => <WhenCell at={row.original.at} now={now} /> },
        { id: "who", accessorFn: (row) => row.actor.key, header: "Who", enableSorting: false, cell: ({ row }) => <WhoCell actor={row.original.actor} /> },
        { id: "what", accessorFn: (row) => row.parts.map((part) => part.text).join(""), header: "What", enableSorting: false, cell: ({ row }) => <WhatCell row={row.original} /> },
        { id: "area", accessorFn: (row) => row.area ?? "", header: "Area", enableSorting: false, cell: ({ row }) => <span className="text-sm whitespace-nowrap">{row.original.area ?? "-"}</span> },
        { id: "from", accessorFn: (row) => row.ipAddress ?? "", header: "From", enableSorting: false, cell: ({ row }) => <FromCell row={row.original} /> },
        {
            id: "open",
            header: () => <span className="sr-only">Open</span>,
            enableSorting: false,
            enableHiding: false,
            meta: { pin: "end", label: "Open" },
            cell: () => <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />,
        },
        // Only here for its filter, which the server applies.
        { id: "action", accessorFn: (row) => row.action, meta: { filterOnly: true } },
    ];
}
