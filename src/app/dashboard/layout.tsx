import { AppSidebar } from "@/components/layout/app-sidebar"
import { Header } from "@/components/layout/header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { auth } from "@/lib/auth"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserPermissions, getCurrentUserWithGroup } from "@/lib/auth/access-control"
import { updateService } from "@/services/system/update-service"
import { logger } from "@/lib/logging/logger"
import { wrapError } from "@/lib/logging/errors"
import prisma from "@/lib/prisma"

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

    // Run all queries in parallel to avoid sequential blocking
    const [permissions, userWithGroup, updateInfo, sourceCount, quickSetupSetting, cookieStore] = await Promise.all([
        getUserPermissions(),
        getCurrentUserWithGroup(),
        updateService.checkForUpdates(),
        prisma.adapterConfig.count({ where: { type: "database" } }),
        prisma.systemSetting.findUnique({ where: { key: "general.showQuickSetup" } }),
        cookies(),
    ]);

    const isSuperAdmin = userWithGroup?.group?.name === "SuperAdmin";
    const forceShowQuickSetup = quickSetupSetting?.value === "true";
    const showQuickSetup = forceShowQuickSetup || sourceCount === 0;
    // Written by SidebarProvider in ui/sidebar.tsx. Reading it here renders a collapsed sidebar collapsed from the first paint.
    const sidebarOpen = cookieStore.get("dbackup_sidebar_state")?.value !== "false";

    return (
        <SidebarProvider defaultOpen={sidebarOpen} className="h-svh overflow-hidden">
            <AppSidebar
                permissions={permissions}
                isSuperAdmin={isSuperAdmin}
                updateAvailable={updateInfo.updateAvailable}
                currentVersion={updateInfo.currentVersion}
                latestVersion={updateInfo.latestVersion}
                showQuickSetup={showQuickSetup}
                groupName={userWithGroup?.group?.name}
            />
            <SidebarInset className="min-w-0 overflow-hidden bg-page">
                <Header />
                <ScrollArea className="min-h-0 flex-1">
                    <div className="p-4 md:p-6">
                        <div className="mx-auto space-y-6">
                            {children}
                        </div>
                    </div>
                </ScrollArea>
            </SidebarInset>
        </SidebarProvider>
    )
}
