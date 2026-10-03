"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { RunRow } from "@/services/history/run-types";
import { RunName, RunStatusCell, SizeCell, StartedCell, StarterCell, TookCell } from "./run-cells";
import { runHref } from "./run-links";

interface ColumnsInput {
    now: number;
    renderActions: (row: RunRow) => React.ReactNode;
}

/** The columns of the runs, with the type, the job and who started it only for their filters. */
export function runColumns({ now, renderActions }: ColumnsInput): ColumnDef<RunRow>[] {
    return [
        { id: "run", accessorFn: (row) => row.name, header: "Run", cell: ({ row }) => <RunName row={row.original} href={runHref(row.original.id)} /> },
        { id: "status", accessorFn: (row) => row.status, header: "Status", cell: ({ row }) => <RunStatusCell row={row.original} /> },
        { id: "started", accessorFn: (row) => row.startedAt, header: "Started", cell: ({ row }) => <StartedCell startedAt={row.original.startedAt} /> },
        { id: "took", accessorFn: (row) => row.durationMs ?? -1, header: "Took", cell: ({ row }) => <TookCell row={row.original} now={now} /> },
        { id: "size", accessorFn: (row) => row.size ?? -1, header: "Size", cell: ({ row }) => <SizeCell row={row.original} /> },
        { id: "startedBy", accessorFn: (row) => row.starter.label, header: "Started by", cell: ({ row }) => <StarterCell starter={row.original.starter} /> },
        { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div> },
        // Only here for the filters, which the server applies.
        { id: "type", accessorFn: (row) => row.type },
        { id: "job", accessorFn: (row) => row.jobId ?? "" },
        { id: "by", accessorFn: (row) => row.starter.key },
    ];
}
