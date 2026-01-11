"use client";

import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area";

interface Execution {
    id: string;
    jobId: string;
    job: { name: string };
    status: "Running" | "Success" | "Failed";
    startedAt: string;
    endedAt?: string;
    logs: string; // JSON string
}

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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Execution History</h2>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Job Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Started At</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Logs</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {executions.length === 0 ? (
                             <TableRow>
                                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                    No executions found.
                                </TableCell>
                            </TableRow>
                        ) : executions.map((exec) => (
                            <TableRow key={exec.id}>
                                <TableCell className="font-medium">{exec.job?.name || "Deleted Job"}</TableCell>
                                <TableCell>
                                    <Badge variant={exec.status === "Success" ? "secondary" : exec.status === "Failed" ? "destructive" : "default"}>
                                        {exec.status}
                                    </Badge>
                                </TableCell>
                                <TableCell>{format(new Date(exec.startedAt), "PPpp")}</TableCell>
                                <TableCell>
                                    {exec.endedAt ?
                                        `${Math.round((new Date(exec.endedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000)}s`
                                        : "-"
                                    }
                                </TableCell>
                                <TableCell>
                                    <span
                                        className="text-blue-500 cursor-pointer hover:underline text-sm"
                                        onClick={() => setSelectedLog(exec)}
                                    >
                                        View Logs
                                    </span>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Execution Logs - {selectedLog?.job?.name}</DialogTitle>
                        <DialogDescription>
                            {selectedLog?.startedAt && format(new Date(selectedLog.startedAt), "PPpp")}
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="h-[400px] w-full rounded-md border p-4 bg-muted font-mono text-xs">
                        {selectedLog && parseLogs(selectedLog.logs).map((line: string, i: number) => (
                            <div key={i} className="mb-1 border-b border-border/50 pb-0.5 last:border-0">
                                {line}
                            </div>
                        ))}
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
}
