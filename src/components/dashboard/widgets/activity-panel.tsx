"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ActivityDataPoint, LatestJobEntry } from "@/services/dashboard-service";
import type { DashboardJobRow } from "@/services/dashboard/types";
import { ActivityChart, ActivityLegend } from "./activity-chart";
import { ExecutionsList } from "./executions-list";
import { JobsList } from "./jobs-list";

type View = "executions" | "jobs";

interface ActivityPanelProps {
    activity: ActivityDataPoint[];
    executions: LatestJobEntry[];
    jobs: { rows: DashboardJobRow[]; total: number };
    canViewHistory: boolean;
    canViewJobs: boolean;
    className?: string;
}

/** Runs per day on top, and below it a switch between the latest executions and the jobs. */
export function ActivityPanel({ activity, executions, jobs, canViewHistory, canViewJobs, className }: ActivityPanelProps) {
    const [view, setView] = useState<View>("executions");

    const heading = view === "executions"
        ? { title: "Latest executions", description: `The ${executions.length} most recent runs` }
        : { title: "Jobs", description: `${jobs.rows.length} of ${jobs.total} shown, sorted by next run` };
    const viewAll = view === "executions"
        ? (canViewHistory ? "/dashboard/history" : null)
        : (canViewJobs ? "/dashboard/jobs" : null);

    return (
        <div className={cn("min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
            <div className="space-y-4 p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                        <h2 className="font-semibold">Jobs activity</h2>
                        <p className="text-sm text-muted-foreground">Last {activity.length} days</p>
                    </div>
                    <ActivityLegend data={activity} />
                </div>
                <ActivityChart data={activity} />
            </div>

            <Tabs value={view} onValueChange={(value) => setView(value as View)} className="gap-0 border-t">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 md:px-5">
                    <div className="min-w-0">
                        <h2 className="font-semibold">{heading.title}</h2>
                        <p className="truncate text-sm text-muted-foreground">{heading.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <TabsList className="h-8">
                            <TabsTrigger value="executions" className="px-2.5 text-xs">Executions</TabsTrigger>
                            <TabsTrigger value="jobs" className="px-2.5 text-xs">Jobs</TabsTrigger>
                        </TabsList>
                        {viewAll && (
                            <Link
                                href={viewAll}
                                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                                View all
                                <ChevronRight className="size-4" aria-hidden="true" />
                            </Link>
                        )}
                    </div>
                </div>
                <TabsContent value="executions">
                    <ExecutionsList executions={executions} canViewHistory={canViewHistory} />
                </TabsContent>
                <TabsContent value="jobs">
                    <JobsList rows={jobs.rows} canViewJobs={canViewJobs} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
