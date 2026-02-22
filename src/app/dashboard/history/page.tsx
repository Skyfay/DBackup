"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
// import { ScrollArea } from "@/components/ui/scroll-area";
// import { format } from "date-fns";
import { DataTable } from "@/components/ui/data-table";
import { createColumns, Execution } from "./columns";
import { createNotificationLogColumns, NotificationLogRow } from "./notification-log-columns";
import { NotificationPreview } from "./notification-preview";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { DateDisplay } from "@/components/utils/date-display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    const [activeTab, setActiveTab] = useState("activity");

    // Notification log state
    const [notificationLogs, setNotificationLogs] = useState<NotificationLogRow[]>([]);
    const [selectedNotification, setSelectedNotification] = useState<NotificationLogRow | null>(null);

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
                // eslint-disable-next-line react-hooks/set-state-in-effect
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
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setSelectedLog(found);
                // Clear the query param so it doesn't re-trigger on close
                router.replace("/dashboard/history", { scroll: false });
            }
        }
    }, [executions, executionId, selectedLog, router]);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetch("/api/history");
            if (res.ok) setExecutions(await res.json());
        } catch (_e) {
            console.error(_e);
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

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchHistory();
        const interval = setInterval(fetchHistory, 1000); // Poll faster (1s) for live feel
        return () => clearInterval(interval);
    }, [fetchHistory]);

    // Fetch notification logs when that tab becomes active
    useEffect(() => {
        if (activeTab === "notifications") {
            fetchNotificationLogs();
            const interval = setInterval(fetchNotificationLogs, 5000);
            return () => clearInterval(interval);
        }
    }, [activeTab, fetchNotificationLogs]);

    const parseLogs = (json: string) => {
        try {
            return JSON.parse(json);
        } catch {
            return ["Invalid log format"];
        }
    };

    const columns = useMemo(() => createColumns(setSelectedLog), []);
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
            ]
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
                    <TabsTrigger value="notifications">
                        Notification Logs
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="activity">
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

                <TabsContent value="notifications">
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
                        <DialogTitle className="flex items-center gap-3">
                             {selectedLog?.status === "Running" && <Loader2 className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-400" />}
                             <span className="font-mono">{selectedLog?.job?.name || selectedLog?.type || "Manual Job"}</span>
                             {selectedLog?.status && (
                                <Badge variant={selectedLog.status === 'Success' ? 'default' : selectedLog.status === 'Failed' ? 'destructive' : 'secondary'}>
                                    {selectedLog.status}
                                </Badge>
                             )}
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            {selectedLog?.startedAt && <DateDisplay date={selectedLog.startedAt} format="PPpp" />}
                        </DialogDescription>
                    </DialogHeader>

                     {selectedLog?.status === "Running" && (
                        <div className="px-6 py-3 bg-card/50 border-b border-border/50 shrink-0">
                            <div className="flex justify-between text-xs text-muted-foreground mb-2">
                                <span>{stage}</span>
                                <span>{progress > 0 ? `${progress}%` : ''}</span>
                            </div>
                            {progress > 0 ? (
                                <Progress value={progress} className="h-1.5 bg-muted" />
                            ) : (
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div className="h-full w-full animate-indeterminate rounded-full bg-blue-500/50 origin-left-right"></div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex-1 min-h-0 bg-background/5">
                         <LogViewer
                            logs={selectedLog ? parseLogs(selectedLog.logs) : []}
                            status={selectedLog?.status}
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
                    <div className="flex-1 min-h-0 p-6 overflow-y-auto">
                        {selectedNotification && (
                            <NotificationPreview entry={selectedNotification} />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
