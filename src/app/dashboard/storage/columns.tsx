"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Database, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import { NameCell } from "@/components/dashboard/storage/cells/name-cell";
// import { SourceJobCell } from "@/components/dashboard/storage/cells/source-job-cell";
import { ActionsCell } from "@/components/dashboard/storage/cells/actions-cell";
import { Badge } from "@/components/ui/badge";

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
    isEncrypted?: boolean;
    encryptionProfileId?: string;
};

interface ColumnsProps {
    onRestore: (file: FileInfo) => void;
    onDownload: (file: FileInfo, decrypt?: boolean) => void;
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
                isEncrypted={row.original.isEncrypted}
            />
        )
    },
    {
        accessorKey: "sourceType",
        header: "Source",
        cell: ({ row }) => {
            const name = row.original.sourceName;
            const type = row.original.sourceType;
            if (!name || name === "Unknown") return <span className="text-muted-foreground">-</span>;
            return (
                <div className="flex items-center gap-2 text-sm">
                    <Database className="h-3 w-3 text-muted-foreground" />
                    <span>{name}</span>
                    {type && <Badge variant="outline" className="text-[10px] h-5 px-1.5">{type}</Badge>}
                </div>
            );
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: "jobName",
        header: "Job context",
        cell: ({ row }) => {
            const name = row.original.jobName;
            const dbLabel = row.original.dbInfo?.label;

            if ((!name || name === "Unknown") && (!dbLabel || dbLabel === "Unknown"))
                return <span className="text-muted-foreground text-xs">-</span>;

            return (
                <div className="flex items-center gap-2 text-sm">
                    {name && name !== "Unknown" && (
                         <>
                            <HardDrive className="h-3 w-3 text-muted-foreground" />
                            <span>{name}</span>
                         </>
                    )}
                    {dbLabel && dbLabel !== "Unknown" && (
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{dbLabel}</Badge>
                    )}
                </div>
            );
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
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
