"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Clock, HardDrive, KeyRound, MousePointerClick } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import { NameCell } from "@/components/dashboard/storage/cells/name-cell";
import { ActionsCell } from "@/components/dashboard/storage/cells/actions-cell";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// This type is used to define the shape of our data.
export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: string;
    jobName?: string;
    sourceName?: string;
    sourceType?: string;
    engineVersion?: string;
    engineEdition?: string;
    dbInfo?: { count: string | number; label: string };
    isEncrypted?: boolean;
    encryptionProfileId?: string;
    compression?: string;
    locked?: boolean;
    trigger?: { type: string; actor?: string };
    storageClass?: string;
    checksum?: string;
    checksumMd5?: string;
    /** True for backups that carry a file index, so individual files can be browsed and restored. */
    hasFileIndex?: boolean;
    /** Incremental chain membership. Absent on standalone full backups. */
    chain?: { id: string; type: 'full' | 'incremental'; index: number };
    /** Complete snapshot size, which for an incremental exceeds the archive's own size. */
    logicalSize?: number;
    verification?: {
        verifiedAt: string;
        passed: boolean;
        trigger: 'manual' | 'post-upload' | 'scheduled';
    };
};

interface ColumnsProps {
    onRestore: (file: FileInfo) => void;
    onDownloadSnapshot: (file: FileInfo) => void;
    onDownload: (file: FileInfo, decrypt?: boolean) => void;
    onDelete: (file: FileInfo) => void;
    onToggleLock: (file: FileInfo) => void;
    onGenerateLink: (file: FileInfo) => void;
    onVerify: (file: FileInfo) => void;
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
}

export const getColumns = ({ onRestore, onDownloadSnapshot, onDownload, onDelete, onToggleLock, onGenerateLink, onVerify, canDownload, canRestore, canDelete }: ColumnsProps): ColumnDef<FileInfo>[] => [
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
                    <AdapterIcon adapterId={type ?? ""} className="h-3 w-3" />
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
        accessorKey: "engineVersion",
        header: "DB Version",
        cell: ({ row }) => {
            const v = row.original.engineVersion;
            if (!v) return <span className="text-muted-foreground text-xs">-</span>;
            return <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{v}</Badge>;
        }
    },
    {
        accessorKey: "compression",
        header: "Compression",
        cell: ({ row }) => {
            const comp = row.original.compression;
            const storageClass = row.original.storageClass;
            const isArchived = storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE";
            const hasContent = isArchived || (comp && comp !== "NONE");

            if (!hasContent) return <span className="text-muted-foreground text-xs">-</span>;

            return (
                <div className="flex items-center gap-1 flex-wrap">
                    {isArchived && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-orange-200 text-orange-700 dark:text-orange-400 dark:border-orange-900">
                            {storageClass === "DEEP_ARCHIVE" ? "Deep Archive" : "Glacier"}
                        </Badge>
                    )}
                    {comp && comp !== "NONE" && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-blue-200 text-blue-700 dark:text-blue-400 dark:border-blue-900">{comp}</Badge>
                    )}
                </div>
            );
        }
    },
    {
        id: "trigger",
        header: "Triggered by",
        cell: ({ row }) => {
            const trigger = row.original.trigger;
            if (!trigger) return <span className="text-muted-foreground text-xs">-</span>;

            const iconClass = "h-3.5 w-3.5 shrink-0";
            let icon: React.ReactNode;
            let badgeClass: string;

            if (trigger.type === "Scheduler") {
                icon = <Clock className={iconClass} />;
                badgeClass = "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800";
            } else if (trigger.type === "Api") {
                icon = <KeyRound className={iconClass} />;
                badgeClass = "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800";
            } else {
                icon = <MousePointerClick className={iconClass} />;
                badgeClass = "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800";
            }

            return (
                <Badge variant="outline" className={`flex items-center gap-1.5 w-fit font-normal ${badgeClass}`}>
                    {icon}
                    <span>{trigger.actor || trigger.type}</span>
                </Badge>
            );
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
            const logical = row.original.logicalSize;

            // For an incremental the archive only stores what changed. Showing that number
            // alone would suggest the snapshot is nearly empty, so the complete snapshot
            // size is shown and the stored size moves into the tooltip.
            const isPartial = typeof logical === "number" && logical > size;

            return (
                <div className="font-medium font-mono text-xs text-right pr-4">
                    {isPartial ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="cursor-help border-b border-dotted border-muted-foreground/50">
                                        {formatBytes(logical!)}
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Complete snapshot. This archive stores {formatBytes(size)}; the rest is
                                    referenced from earlier backups in its chain.
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        formatBytes(size)
                    )}
                </div>
            );
        },
    },
    {
        id: "backupType",
        header: "Type",
        cell: ({ row }) => {
            const chain = row.original.chain;
            if (!chain) return <span className="text-muted-foreground text-xs">-</span>;

            return chain.type === "full" ? (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-emerald-200 text-emerald-700 dark:text-emerald-400 dark:border-emerald-900">
                    Full
                </Badge>
            ) : (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-amber-200 text-amber-700 dark:text-amber-400 dark:border-amber-900">
                                Incremental
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                            Position {chain.index} in its backup chain. Restoring it reads from the earlier
                            archives in the same folder as well.
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
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
                onDownloadSnapshot={onDownloadSnapshot}
                onDelete={onDelete}
                onToggleLock={onToggleLock}
                onGenerateLink={onGenerateLink}
                onVerify={onVerify}
                canDownload={canDownload}
                canRestore={canRestore}
                canDelete={canDelete}
            />
        ),
    },
];
