"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/date-display";
import { formatBytes } from "@/lib/utils";
import { NameCell } from "@/components/dashboard/storage/cells/name-cell";
import { SourceJobCell } from "@/components/dashboard/storage/cells/source-job-cell";
import { ActionsCell } from "@/components/dashboard/storage/cells/actions-cell";

// This type is used to define the shape of our data.
export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: string;
    jobName?: string;
    sourceName?: string;
    sourceType?: string;
    dbInfo?: { count: string | number; label: string };
};

interface ColumnsProps {
    onRestore: (file: FileInfo) => void;
    onDownload: (file: FileInfo) => void;
    onDelete: (file: FileInfo) => void;
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
}

export const createColumns = ({ onRestore, onDownload, onDelete, canDownload, canRestore, canDelete }: ColumnsProps): ColumnDef<FileInfo>[] => [
    {
        accessorKey: "name",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            );
        },
        cell: ({ row }) => (
            <NameCell
                name={row.getValue("name")}
                path={row.original.path}
            />
        )
    },
    {
        accessorKey: "sourceName",
        header: "Source & Job",
        cell: ({ row }) => (
            <SourceJobCell
                jobName={row.original.jobName}
                sourceName={row.original.sourceName}
                sourceType={row.original.sourceType}
                dbLabel={row.original.dbInfo?.label}
            />
        )
    },
    {
        accessorKey: "size",
        header: ({ column }) => {
            return (
                <div className="flex justify-end">
                    <Button
                        variant="ghost"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    >
                        Size
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            );
        },
        cell: ({ row }) => {
            const size = parseFloat(row.getValue("size"));
            const formatted = formatBytes(size);

            return <div className="font-medium font-mono text-xs text-right pr-4">{formatted}</div>;
        },
    },
    {
        accessorKey: "lastModified",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Last Modified
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            );
        },
        cell: ({ row }) => {
            const dateStr: string = row.getValue("lastModified");
            return <div className="text-sm text-muted-foreground"><DateDisplay date={dateStr} format="PP p" /></div>;
        },
    },
    {
        id: "actions",
        cell: ({ row }) => (
            <ActionsCell
                file={row.original}
                onDownload={onDownload}
                onRestore={onRestore}
                onDelete={onDelete}
                canDownload={canDownload}
                canRestore={canRestore}
                canDelete={canDelete}
            />
        ),
    },
];
