import { Fragment, Suspense } from "react"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { PermissionsProvider } from "@/components/permissions/permissions-context"
import { TenantFromLink } from "@/components/tenant/tenant-from-link"
import { TenantViewProvider } from "@/components/tenant/tenant-view"
import { quickSetupTenants } from "@/components/tenant/new-record"
import { TrashDaysProvider } from "@/components/trash/trash-days"
import { Header } from "@/components/layout/header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TableDefaultsProvider } from "@/components/ui/table-defaults"
import { auth } from "@/lib/auth"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserPermissions, getViewer, hasPermissionWithContext } from "@/lib/auth/access-control"
import { PERMISSIONS } from "@/lib/auth/permissions"
import { updateService } from "@/services/system/update-service"
import { getTableDefaults, getTaskColors } from "@/services/user/preference-service"
import { taskColorCss } from "@/lib/core/task-colors"
import { getTrashDays } from "@/services/trash/trash-service"
import { logger } from "@/lib/logging/logger"
import { wrapError } from "@/lib/logging/errors"
import { ownBackupReach, showsQuickSetup } from "@/services/dashboard/start-page"
import { getInstanceName } from "@/services/system/system-settings-service"
import { usesAppleKeys } from "@/lib/core/keyboard"
import { tenantService } from "@/services/tenant/tenant-service"
import { HOME_TENANT_ID } from "@/lib/tenant/home"
import { breadcrumbTenant } from "@/components/layout/tenant-switch"

const log = logger.child({ component: "dashboard-layout" });

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const requestHeaders = await headers();
    let session = null;
    try {
        session = await auth.api.getSession({
            headers: requestHeaders
        })
    } catch (e) {
        log.error("Dashboard session check failed", {}, wrapError(e));
    }

    if (!session) {
        redirect("/")
    }

    // Run all queries in parallel to avoid sequential blocking
    const viewerLoad = getViewer();
    // An account that works in no tenant yet, and is not in All tenants, reads nothing of a tenant:
    // every such query would refuse it and take each page down with it.
    const inTenantLoad = viewerLoad.then((user) => Boolean(user && (user.tenantId || user.allTenants)));
    const [permissions, viewer, tenants, tenantCount, updateInfo, reach, cookieStore, tableDefaults, trashDays, taskColors, instanceName] = await Promise.all([
        getUserPermissions(),
        viewerLoad,
        // The tenants the viewer may switch to, which the head of the sidebar offers from two on.
        viewerLoad.then((user) => (user ? tenantService.switchable(user.id, user.isPlatformAdmin) : [])),
        // With one tenant the head and the breadcrumb name DBackup, with more the tenant.
        tenantService.count(),
        // The last answer of GitHub, so a page never waits for it.
        updateService.getUpdateInfo(),
        // Quick Setup adds a database and builds a job of the tenant's own, which a tenant that may
        // add no database, or has nothing to back up itself, cannot.
        inTenantLoad.then(async (inTenant) => {
            if (!inTenant) return { quickSetup: false, databases: true };
            const [shows, own] = await Promise.all([showsQuickSetup(), ownBackupReach()]);
            return { quickSetup: shows && own.databases && own.jobs, databases: own.databases };
        }),
        cookies(),
        getTableDefaults(session.user.id),
        getTrashDays(),
        getTaskColors(session.user.id),
        getInstanceName(),
    ]);
    // The platform names itself where a tenant may not add something itself.
    const platform = tenantCount > 1 ? await tenantService.find(HOME_TENANT_ID) : null;

    // Written by SidebarProvider in ui/sidebar.tsx. Reading it here renders a collapsed sidebar collapsed from the first paint.
    const sidebarOpen = cookieStore.get("dbackup_sidebar_state")?.value !== "false";
    // The colors the viewer picked for the tasks, over the ones of globals.css. Empty for the default.
    const colorCss = taskColorCss(taskColors);
    const activeTenantId = viewer?.tenantId ?? null;
    const allTenants = viewer?.allTenants ?? false;
    // In All tenants Quick Setup asks for its tenant, so it shows while one of them could take it.
    const showQuickSetup = reach.quickSetup && (!allTenants || quickSetupTenants(tenants, viewer?.isPlatformAdmin ?? false).length > 0);
    // What the head of the sidebar offers of the tenants: All tenants for whoever may open it, the
    // numbers and Manage tenants for whoever may see them, New tenant for whoever may create them.
    // A platform group that reaches only some tenants would create one it can never open.
    const tenantAccess = {
        opensAll: viewer?.opensAllTenants ?? false,
        see: viewer ? hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_READ) : false,
        create: viewer
            ? viewer.isPlatformAdmin || (hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_WRITE) && viewer.platformGroup?.allTenants === true)
            : false,
    };
    // The group in the tenant and the platform group, like "Viewer + Support", or Platform admin.
    const groupName = [viewer?.role?.name, viewer?.platformGroup?.name].filter(Boolean).join(" + ") || (viewer?.isPlatformAdmin ? "Platform admin" : undefined);

    return (
        <>
            {colorCss && <style id="task-colors" dangerouslySetInnerHTML={{ __html: colorCss }} />}
            {/* Lets a field deep inside a form leave out what the viewer may not do, like New, every
                table start with the rows per page and the row height of the viewer's profile, and every
                delete say how long Recently deleted keeps what it deletes. */}
            <PermissionsProvider permissions={permissions}>
                <TenantViewProvider value={{ tenants, activeTenantId, allTenants, isPlatformAdmin: viewer?.isPlatformAdmin ?? false, tenantCount, platformName: platform?.name, showQuickSetup, ownDatabases: reach.databases }}>
                {/* A link of a notification names the tenant of its record, which opens before the page looks for it. */}
                <Suspense fallback={null}><TenantFromLink /></Suspense>
                <TableDefaultsProvider defaults={tableDefaults}>
                    <TrashDaysProvider days={trashDays}>
                        {/* Clip, not hidden: a hidden box can still be scrolled by code. A screen-reader text, which is
                            absolutely placed, escapes the scroll area of the page and gives it room to scroll, so
                            scrollIntoView on details low on a short page pushed the header out and left the bottom empty. */}
                        <SidebarProvider defaultOpen={sidebarOpen} className="h-svh overflow-clip">
                            <AppSidebar
                                permissions={permissions}
                                isPlatformAdmin={viewer?.isPlatformAdmin ?? false}
                                currentVersion={updateInfo.currentVersion}
                                instanceName={instanceName || undefined}
                                showQuickSetup={showQuickSetup}
                                ownDatabases={reach.databases}
                                groupName={groupName}
                                tenants={tenants}
                                activeTenantId={activeTenantId}
                                allTenants={allTenants}
                                tenantCount={tenantCount}
                                tenantAccess={tenantAccess}
                            />
                            <SidebarInset className="min-w-0 overflow-clip bg-page">
                                <Header
                                    updateAvailable={updateInfo.updateAvailable}
                                    currentVersion={updateInfo.currentVersion}
                                    latestVersion={updateInfo.latestVersion}
                                    apple={usesAppleKeys(requestHeaders)}
                                    userId={session.user.id}
                                    tenantName={breadcrumbTenant({ tenants, activeTenantId, allTenants, tenantCount })}
                                />
                                {/* Radix wraps the page in a `display: table` div that grows with its widest child, so a
                                    wide table pushed the whole page past the right edge, clipped and not scrollable.
                                    Block keeps the page at the window's width, and a wide table scrolls inside its card. */}
                                <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                                    <div className="p-4 md:p-6">
                                        <div className="mx-auto space-y-6">
                                            {/* A switch of the tenant mounts the page anew, so no list keeps what it loaded in the browser for the tenant before. */}
                                            <Fragment key={viewer?.allTenants ? "*" : viewer?.tenantId ?? "none"}>{children}</Fragment>
                                        </div>
                                    </div>
                                </ScrollArea>
                            </SidebarInset>
                        </SidebarProvider>
                    </TrashDaysProvider>
                </TableDefaultsProvider>
                </TenantViewProvider>
            </PermissionsProvider>
        </>
    )
}
