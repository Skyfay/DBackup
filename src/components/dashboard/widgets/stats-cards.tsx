import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { Activity, CheckCircle, Clock, XCircle } from "lucide-react";

export async function StatsCards() {
    const totalJobs = await prisma.job.count();
    const activeSchedules = await prisma.job.count({
        where: { enabled: true, schedule: { not: "" } }
    });

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const success24h = await prisma.execution.count({
        where: {
            status: "Success",
            startedAt: { gte: twentyFourHoursAgo }
        }
    });

    const failed24h = await prisma.execution.count({
        where: {
            status: "Failed",
            startedAt: { gte: twentyFourHoursAgo }
        }
    });

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{totalJobs}</div>
                    <p className="text-xs text-muted-foreground">Configured backup jobs</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Schedules</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{activeSchedules}</div>
                    <p className="text-xs text-muted-foreground">Jobs running automatically</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Last 24h Success</CardTitle>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{success24h}</div>
                    <p className="text-xs text-muted-foreground">Successful executions</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Last 24h Failed</CardTitle>
                    <XCircle className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{failed24h}</div>
                    <p className="text-xs text-muted-foreground">Errors requiring attention</p>
                </CardContent>
            </Card>
        </div>
    );
}
