import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { formatBytes } from "@/lib/utils";
import { HardDrive } from "lucide-react";

export async function StorageStatus() {
    // 1. Get all configured storage adapters
    const storageAdapters = await prisma.adapterConfig.findMany({
        where: { type: "storage" }
    });

    if (storageAdapters.length === 0) {
        return (
            <Card className="col-span-3">
                <CardHeader>
                    <CardTitle>Storage Status</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-sm text-muted-foreground">No storage providers configured.</div>
                </CardContent>
            </Card>
        );
    }

    // 2. Aggregate stats per adapter (requires manual grouping usually or raw query,
    //    but let's do simple post-processing for flexibility if volume isn't huge)
    //    Ideally: Execution table doesn't link directly to Storage Adapter ID, it links to Job -> Destination.
    //    But we have `path` in Execution.
    //    Actually, Execution belongs to Job. Job has Destination. Destination is AdapterConfig.
    //    So we can group by job.destinationId.

    // Group executions by destination ID to sum up sizes

    // Note: This logic assumes executions are linked to jobs that still exist.
    // If a job is deleted, the execution loses the link to destinationId via Job relation.
    // For a robust status, we might only show active destinations.

    const stats = new Map<string, { size: number, count: number }>();

    // Initialize map
    storageAdapters.forEach(ad => {
        stats.set(ad.id, { size: 0, count: 0 });
    });

    // Fetch executions with job info
    const executions = await prisma.execution.findMany({
        where: { status: "Success", size: { not: null } },
        select: { size: true, job: { select: { destinationId: true } } }
    });

    executions.forEach(ex => {
        if (ex.job && ex.job.destinationId && stats.has(ex.job.destinationId)) {
            const current = stats.get(ex.job.destinationId)!;
            current.size += (ex.size || 0);
            current.count += 1;
        }
    });

    return (
        <Card className="col-span-3">
            <CardHeader>
                <CardTitle>Storage Usage</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {storageAdapters.map((adapter) => {
                        const stat = stats.get(adapter.id) || { size: 0, count: 0 };
                        return (
                            <div key={adapter.id} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
                                        <HardDrive className="h-4 w-4 text-foreground" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium">{adapter.name}</span>
                                        <span className="text-xs text-muted-foreground">{stat.count} backups</span>
                                    </div>
                                </div>
                                <div className="text-sm font-bold font-mono">
                                    {formatBytes(stat.size)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
