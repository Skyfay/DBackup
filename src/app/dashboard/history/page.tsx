"use client";

import { useEffect, useState, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { DataTable } from "@/components/ui/data-table";
import { createColumns, Execution } from "./columns";

export default function HistoryPage() {
    const [executions, setExecutions] = useState<Execution[]>([]);
    const [selectedLog, setSelectedLog] = useState<Execution | null>(null);

    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await fetch("/api/history");
            if (res.ok) setExecutions(await res.json());
        } catch (e) {
            console.error(e);
        }
    };

    const parseLogs = (json: string) => {
        try {
            return JSON.parse(json);
        } catch {
            return ["Invalid log format"];
        }
    };

    const columns = useMemo(() => createColumns(setSelectedLog), []);

    const filterableColumns = useMemo(() => [
        {
            id: "status",
            title: "Status",
            options: [
                { label: "Success", value: "Success" },
                { label: "Failed", value: "Failed" },
                { label: "Running", value: "Running" },
            ]
        }
    ], []);

    return (
        <div className="space-y-6">
             <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Execution History</h2>
            </div>

            <DataTable
                columns={columns}
                data={executions}
                searchKey="jobName"
                filterableColumns={filterableColumns}
            />

            <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-[80vw] w-full max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Execution Logs - {selectedLog?.job?.name || selectedLog?.type || "Unknown Activity"}</DialogTitle>
                        <DialogDescription>
                            {selectedLog?.startedAt && format(new Date(selectedLog.startedAt), "PPpp")}
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="flex-1 w-full rounded-md border p-4 bg-muted font-mono text-xs">
                        {selectedLog && parseLogs(selectedLog.logs).map((line: string, i: number) => (
                            <div key={i} className="mb-1 border-b border-border/50 pb-0.5 last:border-0 whitespace-pre-wrap break-all">
                                {line}
                            </div>
                        ))}
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
}
