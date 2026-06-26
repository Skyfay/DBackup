"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/data-table";
import { createColumns, createSystemTaskColumns, Execution } from "./columns";
import { createNotificationLogColumns, NotificationLogRow } from "./notification-log-columns";
import { NotificationPreview } from "./notification-preview";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Square, Copy, Download, Bell, CheckCircle2, XCircle } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Progress } from "@/components/ui/progress";
import { DateDisplay } from "@/components/utils/date-display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogViewer } from "@/components/execution/log-viewer";
import { sanitizeLogs } from "@/lib/logs/sanitize";
import { formatLogsAsText, generateLogFilename } from "@/lib/logs/format";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function HistoryPage() {
    return (
        <HistoryContent />
    )
}

function HistoryContent() {
    const [executions, setExecutions] = useState<Execution[]>([]);
    const [systemTasks, setSystemTasks] = useState<Execution[]>([]);
    const [systemTimezone, setSystemTimezone] = useState("UTC");
    const [selectedLog, setSelectedLog] = useState<Execution | null>(null);
    const [activeTab, setActiveTab] = useState("activity");

    // Notification log state
    const [notificationLogs, setNotificationLogs] = useState<NotificationLogRow[]>([]);
    const [selectedNotification, setSelectedNotification] = useState<NotificationLogRow | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    // Per-execution notification results (shown in log dialog)
    const [executionNotifications, setExecutionNotifications] = useState<NotificationLogRow[]>([]);

    const searchParams = useSearchParams();
    const router = useRouter();

    // Auto-open logic
    const executionId = searchParams.get("executionId");

    // Sync selectedLog with latest executions data to enable live updates in modal
    useEffect(() => {
        if (selectedLog) {
            const allExecs = [...executions, ...systemTasks];
            const updatedLog = allExecs.find(e => e.id === selectedLog.id);
            if (updatedLog && JSON.stringify(updatedLog) !== JSON.stringify(selectedLog)) {
                setSelectedLog(updatedLog);
            }
        }
    }, [executions, systemTasks, selectedLog]);

    useEffect(() => {
        if (executionId && (executions.length > 0 || systemTasks.length > 0)) {
            const found = [...executions, ...systemTasks].find(e => e.id === executionId);
            if (found && !selectedLog) {
                setSelectedLog(found);
                router.replace("/dashboard/history", { scroll: false });
            }
        }
    }, [executions, systemTasks, executionId, selectedLog, router]);

    const fetchInFlight = useRef(false);

    const fetchHistory = useCallback(async () => {
        if (fetchInFlight.current) return; // Prevent stacking requests
        fetchInFlight.current = true;
        try {
            const res = await fetch("/api/history");
            if (res.ok) {
                const data = await res.json();
                const systemTypes = ["IntegrityCheck", "Verification"];
                setSystemTasks(data.executions.filter((e: Execution) => systemTypes.includes(e.type ?? "")));
                setExecutions(data.executions.filter((e: Execution) => !systemTypes.includes(e.type ?? "")));
                setSystemTimezone(data.systemTimezone);
            }
        } catch (_e) {
            console.error(_e);
        } finally {
            fetchInFlight.current = false;
        }
    }, []);

    const fetchNotificationLogs = useCallback(async () => {
        try {
            const res = await fetch("/api/notification-logs?pageSize=100");
            if (res.ok) {
                const result = await res.json();
                setNotificationLogs(result.data);
            }
        } catch (_e) {
            console.error(_e);
        }
    }, []);

    // Poll history: 5s default, 2s when any job or system task is running for live feel
    const hasRunningJob = useMemo(
        () => [...executions, ...systemTasks].some(e => e.status === "Running" || e.status === "Pending"),
        [executions, systemTasks]
    );

    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, hasRunningJob ? 2000 : 5000);
        return () => clearInterval(interval);
    }, [fetchHistory, hasRunningJob]);

    // Fetch notification logs when that tab becomes active
    useEffect(() => {
        if (activeTab === "notifications") {
            fetchNotificationLogs();
            const interval = setInterval(fetchNotificationLogs, 5000);
            return () => clearInterval(interval);
        }
    }, [activeTab, fetchNotificationLogs]);

    // Fetch per-execution notification results when a completed execution dialog opens
    useEffect(() => {
        if (!selectedLog || selectedLog.status === "Running" || selectedLog.status === "Pending") {
            setExecutionNotifications([]);
            return;
        }
        fetch(`/api/notification-logs?executionId=${encodeURIComponent(selectedLog.id)}&pageSize=50`)
            .then(r => r.ok ? r.json() : null)
            .then(result => { if (result) setExecutionNotifications(result.data); })
            .catch(() => {});
    }, [selectedLog?.id, selectedLog?.status]);

    const parseLogs = (json: string) => {
        try {
            return JSON.parse(json);
        } catch {
            return ["Invalid log format"];
        }
    };

    const handleCancelExecution = useCallback(async (executionId: string) => {
        setIsCancelling(true);
        try {
            const res = await fetch(`/api/executions/${encodeURIComponent(executionId)}/cancel`, {
                method: "POST",
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Cancellation signal sent");
                fetchHistory();
            } else {
                toast.error(data.error || "Failed to cancel execution");
            }
        } catch {
            toast.error("Failed to cancel execution");
        } finally {
            setIsCancelling(false);
        }
    }, [fetchHistory]);

    const handleCopyLogs = useCallback(() => {
        if (!selectedLog) return;
        const logs = sanitizeLogs(parseLogs(selectedLog.logs));
        const text = formatLogsAsText(logs, {
            jobName: selectedLog.job?.name ?? selectedLog.type ?? "Unknown",
            type: selectedLog.type ?? "Backup",
            status: selectedLog.status,
            startedAt: selectedLog.startedAt,
            endedAt: selectedLog.endedAt,
            triggerType: selectedLog.triggerType,
            triggerLabel: selectedLog.triggerLabel,
        });
        navigator.clipboard.writeText(text)
            .then(() => toast.success("Logs copied to clipboard"))
            .catch(() => toast.error("Failed to copy logs"));
    }, [selectedLog]);

    const handleDownloadLog = useCallback(() => {
        if (!selectedLog) return;
        const logs = sanitizeLogs(parseLogs(selectedLog.logs));
        const text = formatLogsAsText(logs, {
            jobName: selectedLog.job?.name ?? selectedLog.type ?? "Unknown",
            type: selectedLog.type ?? "Backup",
            status: selectedLog.status,
            startedAt: selectedLog.startedAt,
            endedAt: selectedLog.endedAt,
            triggerType: selectedLog.triggerType,
            triggerLabel: selectedLog.triggerLabel,
        });
        const filename = generateLogFilename(
            selectedLog.job?.name ?? selectedLog.type ?? "log",
            selectedLog.startedAt,
        );
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }, [selectedLog]);

    const columns = useMemo(() => createColumns(setSelectedLog), []);
    const systemTaskColumns = useMemo(() => createSystemTaskColumns(setSelectedLog), []);
    const notificationColumns = useMemo(
        () => createNotificationLogColumns(setSelectedNotification),
        []
    );

    const filterableColumns = useMemo(() => [
        {
            id: "type",
            title: "Type",
            options: [
                { label: "Backup", value: "Backup" },
                { label: "Restore", value: "Restore" },
            ]
        },
        {
            id: "status",
            title: "Status",
            options: [
                { label: "Success", value: "Success" },
                { label: "Failed", value: "Failed" },
                { label: "Running", value: "Running" },
                { label: "Cancelled", value: "Cancelled" },
            ]
        },
        {
            id: "trigger",
            title: "Trigger",
            options: [
                { label: "Manual", value: "Manual" },
                { label: "Scheduler", value: "Scheduler" },
                { label: "API Key", value: "Api" },
            ]
        },
    ], []);

    const systemTaskFilterableColumns = useMemo(() => [
        {
            id: "status",
            title: "Status",
            options: [
                { label: "Success", value: "Success" },
                { label: "Failed", value: "Failed" },
                { label: "Running", value: "Running" },
            ],
        },
        {
            id: "trigger",
            title: "Trigger",
            options: [
                { label: "Manual", value: "Manual" },
                { label: "Scheduler", value: "Scheduler" },
            ],
        },
    ], []);

    const notificationFilterableColumns = useMemo(() => [
        {
            id: "adapterId",
            title: "Adapter",
            options: [
                { label: "Email", value: "email" },
                { label: "Discord", value: "discord" },
                { label: "Slack", value: "slack" },
                { label: "Telegram", value: "telegram" },
                { label: "Teams", value: "teams" },
                { label: "ntfy", value: "ntfy" },
                { label: "Gotify", value: "gotify" },
                { label: "Webhook", value: "generic-webhook" },
                { label: "SMS", value: "twilio-sms" },
            ]
        },
        {
            id: "status",
            title: "Status",
            options: [
                { label: "Sent", value: "Success" },
                { label: "Failed", value: "Failed" },
            ]
        },
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
    const detail = metadata?.detail || null;

    return (
        <div className="space-y-6">
             <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Execution History</h2>
                    <p className="text-muted-foreground">View logs and details of past backup and restore operations.</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList>
                    <TabsTrigger value="activity">Activity Logs</TabsTrigger>
                    <TabsTrigger value="system">System Tasks</TabsTrigger>
                    <TabsTrigger value="notifications">Notification Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="activity" className="mt-4">
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
                                onRefresh={fetchHistory}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="system" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>System Tasks</CardTitle>
                            <CardDescription>History of automated system operations such as integrity checks.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                columns={systemTaskColumns}
                                data={systemTasks}
                                searchKey="taskName"
                                filterableColumns={systemTaskFilterableColumns}
                                autoResetPageIndex={false}
                                onRefresh={fetchHistory}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="notifications" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Notification Logs</CardTitle>
                            <CardDescription>
                                History of all notifications sent through your configured channels.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                columns={notificationColumns}
                                data={notificationLogs}
                                searchKey="title"
                                filterableColumns={notificationFilterableColumns}
                                autoResetPageIndex={false}
                                onRefresh={fetchNotificationLogs}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Execution Log Dialog */}
            <Dialog open={!!selectedLog} onOpenChange={(open) => { if(!open) setSelectedLog(null); }}>
                <DialogContent className="max-w-[60vw] w-full max-h-[85vh] h-full flex flex-col p-0 gap-0 overflow-hidden bg-popover border-border sm:max-w-[60vw]">
                    <DialogHeader className="p-6 pb-4 border-b border-border/50 shrink-0">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <DialogTitle className="flex items-center gap-3">
                                     {selectedLog?.status === "Running" && <Loader2 className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-400" />}
                                     <span className="font-mono">{selectedLog?.job?.name || (selectedLog?.type === "IntegrityCheck" ? "Backup Integrity Check" : selectedLog?.type) || "Manual Job"}</span>
                                     {selectedLog?.status && (
                                        selectedLog.status === 'Partial' ? (
                                            <Badge className="bg-[hsl(25,90%,55%)] text-white border-transparent hover:bg-[hsl(25,90%,50%)]">Partial</Badge>
                                        ) : (
                                            <Badge variant={selectedLog.status === 'Success' ? 'default' : selectedLog.status === 'Failed' ? 'destructive' : selectedLog.status === 'Cancelled' ? 'outline' : 'secondary'}>
                                                {selectedLog.status}
                                            </Badge>
                                        )
                                     )}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground">
                                    {selectedLog?.startedAt && <DateDisplay date={selectedLog.startedAt} format="PPpp" timezone={systemTimezone} />}
                                </DialogDescription>
                            </div>
                            {selectedLog?.status !== "Running" && selectedLog?.status !== "Pending" && (
                                <div className="flex items-center gap-2 shrink-0 pt-0.5 mr-6">
                                    <Button variant="outline" size="sm" onClick={handleCopyLogs}>
                                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                                        Copy
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={handleDownloadLog}>
                                        <Download className="h-3.5 w-3.5 mr-1.5" />
                                        Download .log
                                    </Button>
                                </div>
                            )}
                        </div>
                    </DialogHeader>

                     {(selectedLog?.status === "Running" || selectedLog?.status === "Pending") && (
                        <div className="px-6 py-3 bg-card/50 border-b border-border/50 shrink-0">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-medium">{selectedLog?.status === "Pending" ? "Waiting in queue..." : stage}</span>
                                    {detail && <span className="opacity-70">- {detail}</span>}
                                    {selectedLog?.status === "Running" && progress > 0 && !detail && <span>{progress}%</span>}
                                </div>
                                {(
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => selectedLog && handleCancelExecution(selectedLog.id)}
                                        disabled={isCancelling}
                                        className="h-7 text-xs"
                                    >
                                        {isCancelling ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                        ) : (
                                            <Square className="h-3.5 w-3.5 mr-1.5" />
                                        )}
                                        Cancel
                                    </Button>
                                )}
                            </div>
                            {selectedLog?.status === "Running" && (
                                progress > 0 ? (
                                    <Progress value={progress} className="h-1.5 bg-muted" />
                                ) : (
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                        <div className="h-full w-full animate-indeterminate rounded-full bg-blue-500/50 origin-left-right"></div>
                                    </div>
                                )
                            )}
                        </div>
                    )}

                    {executionNotifications.length > 0 && (
                        <div className="px-6 py-2.5 border-b border-border/50 shrink-0 bg-card/30">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Bell className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                {executionNotifications.map((n) => (
                                    <button
                                        key={n.id}
                                        onClick={() => setSelectedNotification(n)}
                                        className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs hover:bg-accent transition-colors"
                                    >
                                        {n.status === "Success" ? (
                                            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                        ) : (
                                            <XCircle className="h-3 w-3 text-destructive shrink-0" />
                                        )}
                                        <AdapterIcon adapterId={n.adapterId} className="h-3 w-3 shrink-0" />
                                        <span className="text-muted-foreground">{n.channelName}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex-1 min-h-0 bg-background/5">
                         <LogViewer
                            logs={selectedLog ? parseLogs(selectedLog.logs) : []}
                            status={selectedLog?.status}
                            executionType={selectedLog?.type}
                            systemTimezone={systemTimezone}
                            className="h-full border-0 bg-transparent"
                         />
                    </div>
                </DialogContent>
            </Dialog>

            {/* Notification Preview Dialog */}
            <Dialog open={!!selectedNotification} onOpenChange={(open) => { if (!open) setSelectedNotification(null); }}>
                <DialogContent className="max-w-175 w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-popover border-border sm:max-w-175">
                    <DialogHeader className="p-6 pb-4 border-b border-border/50 shrink-0">
                        <DialogTitle className="flex items-center gap-3">
                            <span>{selectedNotification?.title}</span>
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            {selectedNotification?.sentAt && (
                                <>
                                    Sent via <span className="font-medium">{selectedNotification.channelName}</span>
                                    {" "}on{" "}
                                    <DateDisplay date={selectedNotification.sentAt} format="PPpp" />
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-6">
                            {selectedNotification && (
                                <NotificationPreview entry={selectedNotification} />
                            )}
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
}
