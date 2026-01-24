import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Database, HardDrive, Loader2 } from "lucide-react";
import { DateDisplay } from "@/components/utils/date-display";
import Link from "next/link";

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
                            const duration = execution.endedAt ? execution.endedAt.getTime() - execution.startedAt.getTime() : 0;

                            // Try to get metadata for accurate display
                            const meta = { jobName: execution.job?.name, sourceName: execution.job?.source?.name, sourceType: execution.job?.source?.type };
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

                            // Status Logic
                            const isRunning = execution.status === "Running";
                            const isSuccess = execution.status === "Success";
                            const isFailed = execution.status === "Failed";

                            let iconColor = isSuccess ? 'text-green-600' : 'text-red-600';
                            let iconBg = isSuccess ? 'border-green-200 bg-green-100' : 'border-red-200 bg-red-100';

                            if (isRunning) {
                                iconColor = 'text-blue-600';
                                iconBg = 'border-blue-200 bg-blue-100';
                            }

                            return (
                                <Link
                                    href={`/dashboard/history?executionId=${execution.id}`}
                                    key={execution.id}
                                    className="block group cursor-pointer"
                                >
                                    <div className="flex items-center justify-between border-b last:border-0 group-hover:bg-muted/50 px-2 py-3 -mx-2 rounded-md transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={`flex h-9 w-9 items-center justify-center rounded-full border ${iconBg}`}>
                                                {isRunning ? (
                                                    <Loader2 className={`h-4 w-4 animate-spin ${iconColor}`} />
                                                ) : (
                                                    meta.sourceType === 'database' ? (
                                                        <Database className={`h-4 w-4 ${iconColor}`} />
                                                    ) : (
                                                        <HardDrive className={`h-4 w-4 ${iconColor}`} />
                                                    )
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium leading-none">{displayName}</p>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    {meta.sourceName && (
                                                        <>
                                                            <span>{meta.sourceName}</span>
                                                            <span>•</span>
                                                        </>
                                                    )}
                                                    <span><DateDisplay date={execution.startedAt} format="PP p" /></span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            {isRunning ? (
                                                 <Badge className="bg-[hsl(225,79%,54%)] text-white border-transparent hover:bg-[hsl(225,79%,48%)]">
                                                    Running
                                                </Badge>
                                            ) : isSuccess ? (
                                                <Badge className="bg-[hsl(145,78%,45%)] text-white border-transparent hover:bg-[hsl(145,78%,40%)]">
                                                    Success
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-[hsl(357,78%,54%)] text-white border-transparent hover:bg-[hsl(357,78%,48%)]">
                                                    {execution.status}
                                                </Badge>
                                            )}

                                            {duration > 0 && !isRunning && (
                                                <span className="text-xs text-muted-foreground font-mono">
                                                    {formatDuration(duration)}
                                                </span>
                                            )}
                                             {isRunning && (
                                                <span className="text-xs text-blue-500 font-medium animate-pulse">
                                                    Live
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </Link>
                            )
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
