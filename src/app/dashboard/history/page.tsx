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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogViewer } from "@/components/execution/log-viewer";
import { Badge } from "@/components/ui/badge";

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

            <Card>
                <CardHeader>
                    <CardTitle>Activity Logs</CardTitle>
                    <CardDescription>Comprehensive list of all system activities and their status.</CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={executions}
                        searchKey="jobName"
                        filterableColumns={filterableColumns}
                        autoResetPageIndex={false}
                    />
                </CardContent>
            </Card>

            <Dialog open={!!selectedLog} onOpenChange={(open) => { if(!open) setSelectedLog(null); }}>
                <DialogContent className="max-w-[80vw] w-full max-h-[85vh] h-full flex flex-col p-0 gap-0 overflow-hidden bg-zinc-950 border-zinc-800">
                    <DialogHeader className="p-6 pb-4 border-b border-white/10 shrink-0">
                        <DialogTitle className="flex items-center gap-3">
                             {selectedLog?.status === "Running" && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
                             <span className="font-mono">{selectedLog?.job?.name || selectedLog?.type || "Manual Job"}</span>
                             {selectedLog?.status && (
                                <Badge variant={selectedLog.status === 'Success' ? 'default' : selectedLog.status === 'Failed' ? 'destructive' : 'secondary'}>
                                    {selectedLog.status}
                                </Badge>
                             )}
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400">
                            {selectedLog?.startedAt && <DateDisplay date={selectedLog.startedAt} format="PPpp" />}
                        </DialogDescription>
                    </DialogHeader>

                     {selectedLog?.status === "Running" && (
                        <div className="px-6 py-3 bg-zinc-900/50 border-b border-white/5 shrink-0">
                            <div className="flex justify-between text-xs text-zinc-400 mb-2">
                                <span>{stage}</span>
                                <span>{progress > 0 ? `${progress}%` : ''}</span>
                            </div>
                            {progress > 0 ? (
                                <Progress value={progress} className="h-1.5 bg-zinc-800" />
                            ) : (
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                                    <div className="h-full w-full animate-indeterminate rounded-full bg-emerald-500/50 origin-left-right"></div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex-1 min-h-0 bg-black/20">
                         <LogViewer logs={selectedLog ? parseLogs(selectedLog.logs) : []} className="h-full border-0 bg-transparent" />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
