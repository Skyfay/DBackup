import { StatsCards } from "@/components/dashboard/widgets/stats-cards";
import { ActivityChart } from "@/components/dashboard/widgets/activity-chart";
import { BackupCalendar } from "@/components/dashboard/widgets/backup-calendar";
import { JobStatusChart } from "@/components/dashboard/widgets/job-status-chart";
import { StorageVolumeChart } from "@/components/dashboard/widgets/storage-volume-chart";
import { LatestJobs } from "@/components/dashboard/widgets/latest-jobs";
import { DashboardRefresh } from "@/components/dashboard/widgets/dashboard-refresh";
import { DashboardBottomGrid } from "@/components/dashboard/bottom-grid";
import {
  getActivityData,
  getCalendarData,
  getAvailableCalendarYears,
  getJobStatusDistribution,
  getStorageVolume,
  getStorageVolumeCacheAge,
  getLatestJobs,
  hasRunningJobs,
} from "@/services/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [activityData, calendarData, availableYears, statusData, storageData, cacheUpdatedAt, latestJobs, isRunning] = await Promise.all([
    getActivityData(14),
    getCalendarData(12),
    getAvailableCalendarYears(),
    getJobStatusDistribution(),
    getStorageVolume(),
    getStorageVolumeCacheAge(),
    getLatestJobs(20),
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

        <DashboardBottomGrid
          left={<LatestJobs data={latestJobs} />}
          right={
            <>
              <JobStatusChart key="job-status" data={statusData} />
              <StorageVolumeChart key="storage-volume" data={storageData} cacheUpdatedAt={cacheUpdatedAt} />
            </>
          }
          bottomLeft={
            <BackupCalendar
              data={calendarData}
              availableYears={availableYears}
            />
          }
        />
      </div>
    </DashboardRefresh>
  )
}
