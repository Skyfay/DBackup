import { StatsCards } from "@/components/dashboard/widgets/stats-cards";
import { RecentActivity } from "@/components/dashboard/widgets/recent-activity";
import { StorageStatus } from "@/components/dashboard/widgets/storage-status";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">Welcome back. Here's what's happening with your backups today.</p>
      </div>

      <StatsCards />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <RecentActivity />
        <StorageStatus />
      </div>
    </div>
  )
}
