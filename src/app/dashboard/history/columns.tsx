"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { formatDuration } from "@/lib/utils";

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
                        <span className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={execution.path}>
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
            return (
                <Badge variant={status === "Success" ? "secondary" : status === "Failed" ? "destructive" : "default"}>
                    {status}
                </Badge>
            );
        }
    },
    {
        accessorKey: "startedAt",
        header: "Started At",
        cell: ({ row }) => {
             return format(new Date(row.getValue("startedAt")), "PPpp");
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
