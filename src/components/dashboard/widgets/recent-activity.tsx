import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { format } from "date-fns";
import { formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Database, HardDrive } from "lucide-react";

export async function RecentActivity() {
    const activities = await prisma.execution.findMany({
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: {
            job: {
                include: {
                    source: true,
                    destination: true
                }
            }
        }
    });

    return (
        <Card className="col-span-4">
            <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {activities.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No recent executions found.</div>
                    ) : (
                        activities.map((execution) => {
                            const isSuccess = execution.status === "Success";
                            const duration = execution.endedAt ? execution.endedAt.getTime() - execution.startedAt.getTime() : 0;

                            // Try to get metadata for accurate display
                            let meta = { jobName: execution.job?.name, sourceName: execution.job?.source?.name, sourceType: execution.job?.source?.type };
                            if (execution.metadata) {
                                try {
                                    const parsed = JSON.parse(execution.metadata);
                                    if(parsed.jobName) meta.jobName = parsed.jobName;
                                    if(parsed.sourceName) meta.sourceName = parsed.sourceName;
                                    if(parsed.sourceType) meta.sourceType = parsed.sourceType;
                                } catch(e) {}
                            }

                            // If job was deleted, fallback to Manual or Unknown
                            const displayName = meta.jobName || (execution.jobId ? "Deleted Job" : "Manual Action");

                            return (
                                <div key={execution.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                                    <div className="flex items-center gap-4">
                                        <div className={`flex h-9 w-9 items-center justify-center rounded-full border ${isSuccess ? 'border-green-200 bg-green-100' : 'border-red-200 bg-red-100'}`}>
                                            {meta.sourceType === 'database' ? (
                                                <Database className={`h-4 w-4 ${isSuccess ? 'text-green-600' : 'text-red-600'}`} />
                                            ) : (
                                                <HardDrive className={`h-4 w-4 ${isSuccess ? 'text-green-600' : 'text-red-600'}`} />
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium leading-none">{displayName}</p>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                {meta.sourceName && <span>{meta.sourceName}</span>}
                                                <span>•</span>
                                                <span>{format(execution.startedAt, "PP p")}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <Badge variant={isSuccess ? "outline" : "destructive"}>
                                            {execution.status}
                                        </Badge>
                                        {duration > 0 && (
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {formatDuration(duration)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
