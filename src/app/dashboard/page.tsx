import { StatsCards } from "@/components/dashboard/widgets/stats-cards";
import { ActivityChart } from "@/components/dashboard/widgets/activity-chart";
import { JobStatusChart } from "@/components/dashboard/widgets/job-status-chart";
import { StorageVolumeChart } from "@/components/dashboard/widgets/storage-volume-chart";
import { LatestJobs } from "@/components/dashboard/widgets/latest-jobs";
import { DashboardRefresh } from "@/components/dashboard/widgets/dashboard-refresh";
import {
  getActivityData,
  getJobStatusDistribution,
  getStorageVolume,
  getStorageVolumeCacheAge,
  getLatestJobs,
  hasRunningJobs,
} from "@/services/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [activityData, statusData, storageData, cacheUpdatedAt, latestJobs, isRunning] = await Promise.all([
    getActivityData(14),
    getJobStatusDistribution(),
    getStorageVolume(),
    getStorageVolumeCacheAge(),
    getLatestJobs(8),
    hasRunningJobs(),
  ]);

  return (
    <DashboardRefresh hasRunningJobs={isRunning}>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground">Welcome back. Here&apos;s what&apos;s happening with your backups today.</p>
        </div>

        <StatsCards />

        <ActivityChart data={activityData} />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <div className="col-span-full lg:col-span-4 min-h-96">
            <LatestJobs data={latestJobs} />
          </div>
          <div className="col-span-full lg:col-span-3 flex flex-col gap-4">
            <JobStatusChart data={statusData} />
            <StorageVolumeChart data={storageData} cacheUpdatedAt={cacheUpdatedAt} />
          </div>
        </div>
      </div>
    </DashboardRefresh>
  )
}
