import { ActivityPanel } from "@/components/dashboard/widgets/activity-panel";
import { BackupCalendar } from "@/components/dashboard/widgets/backup-calendar";
import { DashboardRefresh } from "@/components/dashboard/widgets/dashboard-refresh";
import { KpiCards } from "@/components/dashboard/widgets/kpi-cards";
import { StatsStrip } from "@/components/dashboard/widgets/stats-strip";
import { StatusBanner } from "@/components/dashboard/widgets/status-banner";
import { StorageDestinations } from "@/components/dashboard/widgets/storage-destinations";
import { UpcomingRuns } from "@/components/dashboard/widgets/upcoming-runs";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDashboardOverview } from "@/services/dashboard/overview-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
    const [overview, permissions] = await Promise.all([getDashboardOverview(), getUserPermissions()]);

    const canViewHistory = permissions.includes(PERMISSIONS.HISTORY.READ);
    const canViewStorage = permissions.includes(PERMISSIONS.STORAGE.READ);
    const canViewJobs = permissions.includes(PERMISSIONS.JOBS.READ);
    const canExecute = permissions.includes(PERMISSIONS.JOBS.EXECUTE);
    const hasLiveRuns = overview.strip.runningNow + overview.strip.queuedNow > 0;

    return (
        <DashboardRefresh hasRunningJobs={hasLiveRuns}>
            <h1 className="sr-only">Overview</h1>
            <div className="space-y-4 md:space-y-6">
                <StatusBanner
                    health={overview.health}
                    canExecute={canExecute}
                    canViewHistory={canViewHistory}
                    canManageJobs={permissions.includes(PERMISSIONS.JOBS.WRITE)}
                />
                <KpiCards
                    kpis={overview.kpis}
                    historyHref={canViewHistory ? "/dashboard/history" : undefined}
                    storageHref={canViewStorage ? "/dashboard/storage" : undefined}
                />
                <StatsStrip strip={overview.strip} />
                <UpcomingRuns schedule={overview.upcoming} />
                <div className="grid gap-4 md:gap-6 xl:grid-cols-3">
                    <ActivityPanel
                        className="xl:col-span-2"
                        activity={overview.activity}
                        executions={overview.latestExecutions}
                        jobs={overview.jobs}
                        canViewHistory={canViewHistory}
                        canViewJobs={canViewJobs}
                        canExecute={canExecute}
                    />
                    <div className="grid content-start gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-1">
                        <StorageDestinations {...overview.destinations} />
                        <BackupCalendar {...overview.calendar} />
                    </div>
                </div>
            </div>
        </DashboardRefresh>
    );
}
