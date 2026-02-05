import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserPermissions, getCurrentUserWithGroup } from "@/lib/access-control"
import { updateService } from "@/services/update-service"
import { logger } from "@/lib/logger"
import { wrapError } from "@/lib/errors"

const log = logger.child({ component: "dashboard-layout" });

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    let session = null;
    try {
        session = await auth.api.getSession({
            headers: await headers()
        })
    } catch (e) {
        log.error("Dashboard session check failed", {}, wrapError(e));
    }

    if (!session) {
        redirect("/")
    }

    const permissions = await getUserPermissions();
    const userWithGroup = await getCurrentUserWithGroup();
    const isSuperAdmin = userWithGroup?.group?.name === "SuperAdmin";

    // Check for updates (non-blocking, or parallel if we wanted, but here simple await is fine as it's cached)
    // Actually, to avoid slowing down dashboard load, we might want to wrap in Suspense or just let it block a bit.
    // Next.js patches fetch, so subsequent requests are fast.
    const updateInfo = await updateService.checkForUpdates();

    return (
        <div className="flex min-h-screen">
            <Sidebar
                permissions={permissions}
                isSuperAdmin={isSuperAdmin}
                updateAvailable={updateInfo.updateAvailable}
                currentVersion={updateInfo.currentVersion}
                latestVersion={updateInfo.latestVersion}
            />
            <div className="flex-1 flex flex-col min-h-screen">
                <Header />
                <main className="flex-1 overflow-y-auto bg-muted/10 p-6">
                    <div className="mx-auto space-y-6">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    )
}
