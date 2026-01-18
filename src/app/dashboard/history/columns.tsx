"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { DateDisplay } from "@/components/date-display";

export interface Execution {
    id: string;
    jobId?: string;
    job?: { name: string };
    type?: string;
    status: "Running" | "Success" | "Failed";
    startedAt: string;
    endedAt?: string;
    logs: string; // JSON string
    path?: string;
}

export const createColumns = (onViewLogs: (execution: Execution) => void): ColumnDef<Execution>[] => [
    {
        id: "jobName",
        accessorFn: (row) => row.job?.name || "Manual Action",
        header: "Job / Resource",
        cell: ({ row }) => {
            const execution = row.original;
            return (
                <div className="flex flex-col">
                    <span className="font-medium">
                        {row.getValue("jobName")}
                    </span>
                    {execution.path && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-150" title={execution.path}>
                            {execution.path}
                        </span>
                    )}
                </div>
            )
        }
    },
    {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => {
            const type = row.getValue("type") as string;
            return <Badge variant="outline">{type || "Backup"}</Badge>;
        }
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string;
            let variant: "default" | "secondary" | "destructive" | "outline" = "default";

            if (status === "Success") variant = "secondary"; // Green-ish in shadcn default theme usually, or we can customize
            else if (status === "Failed") variant = "destructive";
            else if (status === "Running") variant = "outline"; // Or use a custom class for Blue/Yellow

            return (
                <Badge variant={variant} className={status === "Running" ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-200" : ""}>
                    {status}
                </Badge>
            );
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: "startedAt",
        header: "Started At",
        cell: ({ row }) => {
             return <DateDisplay date={row.getValue("startedAt")} format="PPpp" />;
        }
    },
    {
        accessorKey: "endedAt",
        header: "Duration",
        cell: ({ row }) => {
            const start = new Date(row.original.startedAt);
            const end = row.original.endedAt ? new Date(row.original.endedAt) : null;
            if (!end) return <span className="text-muted-foreground italic">Running...</span>;

            const diff = end.getTime() - start.getTime();
            return <span>{formatDuration(diff)}</span>;
        }
    },
    {
        id: "actions",
        cell: ({ row }) => {
            return (
                <Button variant="ghost" size="sm" onClick={() => onViewLogs(row.original)}>
                    <FileText className="mr-2 h-4 w-4" />
                    Logs
                </Button>
            );
        }
    }
];
