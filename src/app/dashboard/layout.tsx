import { AppSidebar } from "@/components/layout/app-sidebar"
import { PermissionsProvider } from "@/components/permissions/permissions-context"
import { TrashDaysProvider } from "@/components/trash/trash-days"
import { Header } from "@/components/layout/header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TableDefaultsProvider } from "@/components/ui/table-defaults"
import { auth } from "@/lib/auth"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserPermissions, getCurrentUserWithGroup } from "@/lib/auth/access-control"
import { updateService } from "@/services/system/update-service"
import { getTableDefaults } from "@/services/user/preference-service"
import { getTrashDays } from "@/services/trash/trash-service"
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
    const [permissions, userWithGroup, updateInfo, sourceCount, quickSetupSetting, cookieStore, tableDefaults, trashDays] = await Promise.all([
        getUserPermissions(),
        getCurrentUserWithGroup(),
        updateService.checkForUpdates(),
        prisma.adapterConfig.count({ where: { type: "database" } }),
        prisma.systemSetting.findUnique({ where: { key: "general.showQuickSetup" } }),
        cookies(),
        getTableDefaults(session.user.id),
        getTrashDays(),
    ]);

    const isSuperAdmin = userWithGroup?.group?.name === "SuperAdmin";
    const forceShowQuickSetup = quickSetupSetting?.value === "true";
    const showQuickSetup = forceShowQuickSetup || sourceCount === 0;
    // Written by SidebarProvider in ui/sidebar.tsx. Reading it here renders a collapsed sidebar collapsed from the first paint.
    const sidebarOpen = cookieStore.get("dbackup_sidebar_state")?.value !== "false";

    return (
        // Lets a field deep inside a form leave out what the viewer may not do, like New, every
        // table start with the rows per page and the row height of the viewer's profile, and every
        // delete say how long Recently deleted keeps what it deletes.
        <PermissionsProvider permissions={permissions}>
            <TableDefaultsProvider defaults={tableDefaults}>
                <TrashDaysProvider days={trashDays}>
                    {/* Clip, not hidden: a hidden box can still be scrolled by code. A screen-reader text, which is
                        absolutely placed, escapes the scroll area of the page and gives it room to scroll, so
                        scrollIntoView on details low on a short page pushed the header out and left the bottom empty. */}
                    <SidebarProvider defaultOpen={sidebarOpen} className="h-svh overflow-clip">
                        <AppSidebar
                            permissions={permissions}
                            isSuperAdmin={isSuperAdmin}
                            updateAvailable={updateInfo.updateAvailable}
                            currentVersion={updateInfo.currentVersion}
                            latestVersion={updateInfo.latestVersion}
                            showQuickSetup={showQuickSetup}
                            groupName={userWithGroup?.group?.name}
                        />
                        <SidebarInset className="min-w-0 overflow-clip bg-page">
                            <Header />
                            {/* Radix wraps the page in a `display: table` div that grows with its widest child, so a
                                wide table pushed the whole page past the right edge, clipped and not scrollable.
                                Block keeps the page at the window's width, and a wide table scrolls inside its card. */}
                            <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                                <div className="p-4 md:p-6">
                                    <div className="mx-auto space-y-6">
                                        {children}
                                    </div>
                                </div>
                            </ScrollArea>
                        </SidebarInset>
                    </SidebarProvider>
                </TrashDaysProvider>
            </TableDefaultsProvider>
        </PermissionsProvider>
    )
}
