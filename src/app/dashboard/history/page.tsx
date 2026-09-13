"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
import { usePagedList, type PagedQuery } from "./use-paged-list";
import { loadExecutions, loadNotificationLogs, loadExecution } from "./history-api";
import type { ExecutionHistoryFacets } from "@/services/system/execution-history-service";
import type { NotificationLogFacets } from "@/services/notifications/notification-log-service";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Square, Copy, Download, Bell, CheckCircle2, XCircle } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Progress } from "@/components/ui/progress";
import { DateDisplay } from "@/components/utils/date-display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogViewer } from "@/components/execution/log-viewer";
import { sanitizeLogs } from "@/lib/logs/sanitize";
import { LogEntry } from "@/lib/core/logs";
import { formatLogsAsText, generateLogFilename } from "@/lib/logs/format";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ component: "HistoryPage" });

export default function HistoryPage() {
    return (
        <HistoryContent />
    )
}

function HistoryContent() {
    const [systemTimezone, setSystemTimezone] = useState("UTC");
    const [selectedLog, setSelectedLog] = useState<Execution | null>(null);
    const [selectedLogEntries, setSelectedLogEntries] = useState<LogEntry[]>([]);
    const [activeTab, setActiveTab] = useState("activity");

    const [selectedNotification, setSelectedNotification] = useState<NotificationLogRow | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    // Per-execution notification results (shown in log dialog)
    const [executionNotifications, setExecutionNotifications] = useState<NotificationLogRow[]>([]);

    const searchParams = useSearchParams();
    const router = useRouter();

    // Each tab is its own server-side page. Only the visible tab fetches and polls, and a
    // poll returns exactly the rows on screen, so the cost of a tick no longer grows with the
    // size of the history.
    const onExecutionsLoaded = useCallback((result: { systemTimezone?: string }) => {
        if (result.systemTimezone) setSystemTimezone(result.systemTimezone);
    }, []);
    const loadActivity = useCallback((q: PagedQuery) => loadExecutions("activity", q), []);
    const loadSystem = useCallback((q: PagedQuery) => loadExecutions("system", q), []);

    const [activityPollMs, setActivityPollMs] = useState(5000);
    const [systemPollMs, setSystemPollMs] = useState(5000);

    // Counts shown next to each filter option. Served with every page, since the browser no
    // longer holds the rows they would otherwise be derived from.
    const [activityFacets, setActivityFacets] = useState<ExecutionHistoryFacets | null>(null);
    const [systemFacets, setSystemFacets] = useState<ExecutionHistoryFacets | null>(null);
    const [notificationFacets, setNotificationFacets] = useState<NotificationLogFacets | null>(null);

    // Poll 2s while a run on the visible page is live, 5s otherwise.
    const pollFor = useCallback((rows: Execution[]) =>
        rows.some((e) => e.status === "Running" || e.status === "Pending") ? 2000 : 5000, []);

    type ExecutionsResult = { rows: Execution[]; systemTimezone?: string; facets?: ExecutionHistoryFacets };
    const activity = usePagedList<Execution>({
        load: loadActivity,
        enabled: activeTab === "activity",
        pollMs: activityPollMs,
        onLoaded: (r) => {
            const result = r as ExecutionsResult;
            onExecutionsLoaded(result);
            setActivityPollMs(pollFor(result.rows));
            if (result.facets) setActivityFacets(result.facets);
        },
    });
    const system = usePagedList<Execution>({
        load: loadSystem,
        enabled: activeTab === "system",
        pollMs: systemPollMs,
        onLoaded: (r) => {
            const result = r as ExecutionsResult;
            onExecutionsLoaded(result);
            setSystemPollMs(pollFor(result.rows));
            if (result.facets) setSystemFacets(result.facets);
        },
    });
    const notifications = usePagedList<NotificationLogRow>({
        load: loadNotificationLogs,
        enabled: activeTab === "notifications",
        pollMs: 5000,
        onLoaded: (r) => {
            const facets = (r as { facets?: NotificationLogFacets }).facets;
            if (facets) setNotificationFacets(facets);
        },
    });

    // Auto-open from ?executionId=. The run may sit on any page, so it is fetched by id.
    const executionId = searchParams.get("executionId");
    useEffect(() => {
        if (!executionId) return;
        let cancelled = false;
        loadExecution(executionId).then((found) => {
            if (cancelled) return;
            if (found) setSelectedLog(found);
            router.replace("/dashboard/history", { scroll: false });
        });
        return () => { cancelled = true; };
    }, [executionId, router]);

    // The open execution's log, fetched on its own.
    //
    // The list endpoint carries no log blobs, so this is where the log viewer's content comes
    // from. It also keeps the dialog's status, progress and timestamps current while the run is
    // live, independent of which list page is loaded, and stops as soon as the run reaches a
    // terminal state - a finished log does not change again.
    const selectedId = selectedLog?.id ?? null;
    const selectedIsLive = selectedLog?.status === "Running" || selectedLog?.status === "Pending";

    const fetchSelectedLogs = useCallback(async (id: string) => {
        try {
            const res = await fetch(`/api/executions/${encodeURIComponent(id)}?includeLogs=true`);
            if (!res.ok) return;
            const result = await res.json();
            if (Array.isArray(result?.data?.logs)) setSelectedLogEntries(result.data.logs);
            const d = result?.data;
            if (!d) return;
            setSelectedLog((current) => {
                if (!current || current.id !== id) return current;
                const changed = d.status !== current.status
                    || (d.metadata ?? undefined) !== current.metadata
                    || (d.endedAt ?? undefined) !== current.endedAt
                    || (d.path ?? undefined) !== current.path;
                if (!changed) return current;
                return {
                    ...current,
                    status: d.status,
                    metadata: d.metadata ?? undefined,
                    endedAt: d.endedAt ?? undefined,
                    path: d.path ?? undefined,
                };
            });
        } catch (e) {
            log.error("Failed to load execution logs", {}, wrapError(e));
        }
    }, []);

    useEffect(() => {
        if (!selectedId) {
            setSelectedLogEntries([]);
            return;
        }

        fetchSelectedLogs(selectedId);
        if (!selectedIsLive) return;

        const interval = setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) return;
            fetchSelectedLogs(selectedId);
        }, 2000);
        return () => clearInterval(interval);
    }, [selectedId, selectedIsLive, fetchSelectedLogs]);

    // Fetch per-execution notification results when a completed execution dialog opens.
    useEffect(() => {
        if (!selectedLog || selectedLog.status === "Running" || selectedLog.status === "Pending") {
            setExecutionNotifications([]);
            return;
        }
        fetch(`/api/notification-logs?executionId=${encodeURIComponent(selectedLog.id)}&pageSize=50`)
            .then(r => r.ok ? r.json() : null)
            .then(result => { if (result) setExecutionNotifications(result.data); })
            .catch(() => {});
    }, [selectedLog]);

    const refreshExecutions = activeTab === "system" ? system.refresh : activity.refresh;

    const handleCancelExecution = useCallback(async (executionId: string) => {
        setIsCancelling(true);
        try {
            const res = await fetch(`/api/executions/${encodeURIComponent(executionId)}/cancel`, {
                method: "POST",
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Cancellation signal sent");
                refreshExecutions();
            } else {
                toast.error(data.error || "Failed to cancel execution");
            }
        } catch {
            toast.error("Failed to cancel execution");
        } finally {
            setIsCancelling(false);
        }
    }, [refreshExecutions]);

    const handleCopyLogs = useCallback(() => {
        if (!selectedLog) return;
        const logs = sanitizeLogs(selectedLogEntries);
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
    }, [selectedLog, selectedLogEntries]);

    const handleDownloadLog = useCallback(() => {
        if (!selectedLog) return;
        const logs = sanitizeLogs(selectedLogEntries);
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
    }, [selectedLog, selectedLogEntries]);

    const columns = useMemo(() => createColumns(setSelectedLog), []);
    const systemTaskColumns = useMemo(() => createSystemTaskColumns(setSelectedLog), []);
    const notificationColumns = useMemo(
        () => createNotificationLogColumns(setSelectedNotification),
        []
    );

    // Options carry their server-side count. Zero until the first page has arrived.
    const withCounts = (options: { label: string; value: string }[], counts: Record<string, number> | undefined) =>
        options.map((o) => ({ ...o, count: counts?.[o.value] ?? 0 }));

    const filterableColumns = useMemo(() => [
        {
            id: "type",
            title: "Type",
            options: withCounts([
                { label: "Backup", value: "Backup" },
                { label: "Restore", value: "Restore" },
            ], activityFacets?.type),
        },
        {
            id: "status",
            title: "Status",
            options: withCounts([
                { label: "Success", value: "Success" },
                { label: "Partial", value: "Partial" },
                { label: "Failed", value: "Failed" },
                { label: "Running", value: "Running" },
                { label: "Cancelled", value: "Cancelled" },
            ], activityFacets?.status),
        },
        {
            id: "trigger",
            title: "Trigger",
            options: withCounts([
                { label: "Manual", value: "Manual" },
                { label: "Scheduler", value: "Scheduler" },
                { label: "API Key", value: "Api" },
            ], activityFacets?.trigger),
        },
    ], [activityFacets]);

    const systemTaskFilterableColumns = useMemo(() => [
        {
            id: "status",
            title: "Status",
            options: withCounts([
                { label: "Success", value: "Success" },
                { label: "Partial", value: "Partial" },
                { label: "Failed", value: "Failed" },
                { label: "Running", value: "Running" },
            ], systemFacets?.status),
        },
        {
            id: "trigger",
            title: "Trigger",
            options: withCounts([
                { label: "Manual", value: "Manual" },
                { label: "Scheduler", value: "Scheduler" },
            ], systemFacets?.trigger),
        },
    ], [systemFacets]);

    const notificationFilterableColumns = useMemo(() => [
        {
            id: "adapterId",
            title: "Adapter",
            options: withCounts([
                { label: "Email", value: "email" },
                { label: "Discord", value: "discord" },
                { label: "Slack", value: "slack" },
                { label: "Telegram", value: "telegram" },
                { label: "Teams", value: "teams" },
                { label: "ntfy", value: "ntfy" },
                { label: "Gotify", value: "gotify" },
                { label: "Webhook", value: "generic-webhook" },
                { label: "SMS", value: "twilio-sms" },
            ], notificationFacets?.adapterId),
        },
        {
            id: "status",
            title: "Status",
            options: withCounts([
                { label: "Sent", value: "Success" },
                { label: "Failed", value: "Failed" },
            ], notificationFacets?.status),
        },
    ], [notificationFacets]);

    // Keyed on the raw string so it is re-parsed only when the server actually sent a new one,
    // not on every render caused by an unrelated piece of state on this page.
    const metadata = useMemo(() => {
        if (!selectedLog?.metadata) return null;
        try {
            return JSON.parse(selectedLog.metadata) as Record<string, unknown>;
        } catch {
            return null;
        }
    }, [selectedLog?.metadata]);

    const progress = (metadata?.progress as number | undefined) ?? 0;
    const stage = (metadata?.stage as string | undefined) || (selectedLog?.type === "Restore" ? "Restoring..." : "Initializing...");
    const detail = (metadata?.detail as string | undefined) || null;

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
                                data={activity.rows}
                                searchKey="jobName"
                                filterableColumns={filterableColumns}
                                manualPagination
                                manualFiltering
                                pagination={activity.pagination}
                                onPaginationChange={activity.setPagination}
                                columnFilters={activity.columnFilters}
                                onColumnFiltersChange={activity.onColumnFiltersChange}
                                pageCount={activity.pageCount}
                                rowCount={activity.total}
                                onRefresh={activity.refresh}
                                isLoading={activity.isLoading}
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
                                data={system.rows}
                                searchKey="taskName"
                                filterableColumns={systemTaskFilterableColumns}
                                manualPagination
                                manualFiltering
                                pagination={system.pagination}
                                onPaginationChange={system.setPagination}
                                columnFilters={system.columnFilters}
                                onColumnFiltersChange={system.onColumnFiltersChange}
                                pageCount={system.pageCount}
                                rowCount={system.total}
                                onRefresh={system.refresh}
                                isLoading={system.isLoading}
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
                                data={notifications.rows}
                                searchKey="title"
                                filterableColumns={notificationFilterableColumns}
                                manualPagination
                                manualFiltering
                                pagination={notifications.pagination}
                                onPaginationChange={notifications.setPagination}
                                columnFilters={notifications.columnFilters}
                                onColumnFiltersChange={notifications.onColumnFiltersChange}
                                pageCount={notifications.pageCount}
                                rowCount={notifications.total}
                                onRefresh={notifications.refresh}
                                isLoading={notifications.isLoading}
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
                            logs={selectedLogEntries}
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
