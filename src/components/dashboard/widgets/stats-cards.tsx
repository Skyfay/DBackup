import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/services/dashboard-service";
import { formatBytes } from "@/lib/utils";
import {
    Activity,
    CheckCircle,
    Clock,
    Database,
    HardDrive,
    TrendingUp,
    XCircle,
} from "lucide-react";

export async function StatsCards() {
    const stats = await getDashboardStats();

    return (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.totalJobs}</div>
                    <p className="text-xs text-muted-foreground">Configured backup jobs</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Schedules</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.activeSchedules}</div>
                    <p className="text-xs text-muted-foreground">Jobs running automatically</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Backups</CardTitle>
                    <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.totalSnapshots}</div>
                    <p className="text-xs text-muted-foreground">Across all destinations</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Storage</CardTitle>
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatBytes(stats.totalStorageBytes)}</div>
                    <p className="text-xs text-muted-foreground">Across all destinations</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.successRate30d}%</div>
                    <p className="text-xs text-muted-foreground">Last 30 days</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">24h Success</CardTitle>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.success24h}</div>
                    <p className="text-xs text-muted-foreground">Successful executions</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">24h Failed</CardTitle>
                    <XCircle className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.failed24h}</div>
                    <p className="text-xs text-muted-foreground">Errors requiring attention</p>
                </CardContent>
            </Card>
        </div>
    );
}
