import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { formatBytes } from "@/lib/utils";
import { AdapterIcon } from "@/components/adapter/adapter-icon";

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

    // Aggregate stats per storage adapter via JobDestination join table

    const stats = new Map<string, { size: number, count: number }>();

    storageAdapters.forEach(ad => {
        stats.set(ad.id, { size: 0, count: 0 });
    });

    // Fetch executions with job destinations
    const executions = await prisma.execution.findMany({
        where: { status: { in: ["Success", "Partial"] }, size: { not: null } },
        select: { size: true, job: { select: { destinations: { select: { configId: true } } } } }
    });

    executions.forEach(ex => {
        if (!ex.job) return;
        const size = ex.size ? Number(ex.size) : 0;
        for (const dest of ex.job.destinations) {
            if (stats.has(dest.configId)) {
                const current = stats.get(dest.configId)!;
                current.size += size;
                current.count += 1;
            }
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
                                        <AdapterIcon adapterId={adapter.adapterId} className="h-4 w-4" />
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
