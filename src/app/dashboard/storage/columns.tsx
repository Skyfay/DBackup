"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, RotateCcw, Trash2, Download, Database, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/date-display";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";

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
}

export const createColumns = ({ onRestore, onDownload, onDelete }: ColumnsProps): ColumnDef<FileInfo>[] => [
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
        cell: ({ row }) => {
            const path = row.original.path;
            const name = row.getValue("name") as string;
            return (
                <div className="flex flex-col space-y-1">
                    <span className="font-medium text-sm">{name}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[250px] font-mono" title={path}>{path}</span>
                </div>
            )
        }
    },
    {
        accessorKey: "sourceName",
        header: "Source & Job",
        cell: ({ row }) => {
            const job = row.original.jobName;
            const source = row.original.sourceName;
            const type = row.original.sourceType;

            if (!job && !source) return <span className="text-muted-foreground">-</span>

            return (
                <div className="flex flex-col space-y-1">
                    {source !== "Unknown" && (
                         <div className="flex items-center gap-1.5 text-sm">
                             <Database className="h-3 w-3 text-muted-foreground" />
                             <span>{source}</span>
                             {type && <Badge variant="outline" className="text-[9px] h-4 px-1">{type}</Badge>}
                         </div>
                    )}
                    {job !== "Unknown" && (
                         <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                             <HardDrive className="h-3 w-3" />
                             <span>{job}</span>
                             {row.original.dbInfo?.label && row.original.dbInfo.label !== "Unknown" && (
                                 <Badge variant="secondary" className="text-[9px] h-4 px-1">{row.original.dbInfo.label}</Badge>
                             )}
                         </div>
                    )}
                </div>
            )
        }
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
        cell: ({ row }) => {
            const file = row.original;

            return (
                <div className="flex items-center justify-end gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDownload(file)}>
                                    <Download className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRestore(file)}>
                                    <RotateCcw className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Restore</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                     <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(file)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            );
        },
    },
];
