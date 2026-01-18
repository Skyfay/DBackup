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
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { DateDisplay } from "@/components/utils/date-display";

export default function HistoryPage() {
    return (
        <HistoryContent />
    )
}

function HistoryContent() {
    const [executions, setExecutions] = useState<Execution[]>([]);
    const [selectedLog, setSelectedLog] = useState<Execution | null>(null);
    const searchParams = useSearchParams();
    const router = useRouter();

    // Auto-open logic
    const executionId = searchParams.get("executionId");

    // Sync selectedLog with latest executions data to enable live updates in modal
    useEffect(() => {
        if (selectedLog) {
            const updatedLog = executions.find(e => e.id === selectedLog.id);
            // Only update if the content has actually changed to prevent loops
            if (updatedLog && JSON.stringify(updatedLog) !== JSON.stringify(selectedLog)) {
                setSelectedLog(updatedLog);
            }
        }
    }, [executions, selectedLog]);

    useEffect(() => {
        if (executionId && executions.length > 0) {
            // Check if we are already viewing it or explicitly closed it (not easily tracked here without ref, but let's assume if query param exists we want to open)
            // To prevent re-opening, we remove the query param immediately after finding the log
            const found = executions.find(e => e.id === executionId);
            if (found && !selectedLog) {
                setSelectedLog(found);
                // Clear the query param so it doesn't re-trigger on close
                router.replace("/dashboard/history", { scroll: false });
            }
        }
    }, [executions, executionId, selectedLog, router]);

    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, 1000); // Poll faster (1s) for live feel
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

    const parseMetadata = (json?: string | null) => {
        if (!json) return null;
        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    };

    const metadata = selectedLog ? parseMetadata(selectedLog.metadata) : null;
    const progress = metadata?.progress ?? 0;
    const stage = metadata?.stage || (selectedLog?.type === "Restore" ? "Restoring..." : "Initializing...");

    return (
        <div className="space-y-6">
             <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Execution History</h2>
                    <p className="text-muted-foreground">View logs and details of past backup and restore operations.</p>
                </div>
            </div>

            <DataTable
                columns={columns}
                data={executions}
                searchKey="jobName"
                filterableColumns={filterableColumns}
                autoResetPageIndex={false}
            />

            <Dialog open={!!selectedLog} onOpenChange={(open) => { if(!open) setSelectedLog(null); }}>
                <DialogContent className="max-w-[80vw] w-full max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                             {selectedLog?.status === "Running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                             Execution Logs - {selectedLog?.job?.name || selectedLog?.type || "Unknown Activity"}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedLog?.startedAt && <DateDisplay date={selectedLog.startedAt} format="PPpp" />}
                            {selectedLog?.status === "Running" && " (Live)"}
                        </DialogDescription>
                    </DialogHeader>

                     {selectedLog?.status === "Running" && (
                        <div className="px-4 py-2 space-y-1 bg-secondary/20">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{stage}</span>
                                <span>{progress > 0 ? `${progress}%` : ''}</span>
                            </div>
                            {progress > 0 ? (
                                <Progress value={progress} className="h-2" />
                            ) : (
                                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                                    <div className="h-full w-full animate-indeterminate rounded-full bg-primary/50 origin-left-right"></div>
                                </div>
                            )}
                        </div>
                    )}

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
