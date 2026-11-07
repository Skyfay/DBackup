import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TENANTS_TABLE_ID } from "@/components/dashboard/platform/platform-tables";
import { TenantsClient } from "@/components/dashboard/tenants/tenants-client";
import { withSummaries } from "@/components/dashboard/tenants/tenant-words";
import { getViewer, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { tenantService } from "@/services/tenant/tenant-service";
import { tenantSummaries } from "@/services/tenant/tenant-summaries";
import { platformGroupService } from "@/services/user/platform-group-service";
import { getTablePreferences } from "@/services/user/preference-service";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Tenants" };

/**
 * The tenants of this DBackup with what each holds, under Platform. Whoever may see the tenants
 * opens it, someone of a platform group with the tenants they may open. Whoever may manage them
 * creates, changes, deletes and gives members here. The tenants are the platform's.
 */
export default async function TenantsPage() {
    const viewer = await getViewer();
    // The login lives on the root page, there is no /login.
    if (!viewer) redirect("/");
    if (!hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_READ)) redirect("/dashboard");

    const [all, reachable, layouts] = await Promise.all([
        tenantService.list(),
        viewer.isPlatformAdmin ? null : tenantService.switchable(viewer.id, false),
        getTablePreferences(viewer.id, [TENANTS_TABLE_ID]),
    ]);
    const tenants = reachable ? all.filter((tenant) => reachable.some((entry) => entry.id === tenant.id)) : all;
    const canManage = hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_WRITE);
    // A membership opens a tenant, but only a platform admin and the platform group that reaches it
    // look after it here, and only one who reaches every tenant reaches a new one.
    const [summaries, managed, reachesAll] = await Promise.all([
        tenantSummaries(tenants.map((tenant) => tenant.id)),
        !canManage ? [] : viewer.isPlatformAdmin ? null : platformGroupService.reachedAmong(viewer.id, tenants.map((tenant) => tenant.id)),
        canManage && !viewer.isPlatformAdmin ? platformGroupService.reachesAll(viewer.id) : false,
    ]);
    const rows = withSummaries(tenants, summaries);

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Tenants</h1>
            {/* The members of a tenant open from ?open=, which reads the address. */}
            <Suspense fallback={null}>
                <TenantsClient
                    rows={rows}
                    activeTenantId={viewer.tenantId}
                    viewerId={viewer.id}
                    canManage={canManage}
                    managedIds={managed}
                    canCreate={canManage && (viewer.isPlatformAdmin || reachesAll)}
                    viewerPlatformAdmin={viewer.isPlatformAdmin}
                    // Someone of a platform group sees where their view comes from, like "Read only, through Support".
                    through={viewer.platformGroup?.name ?? null}
                    initialLayout={layouts[TENANTS_TABLE_ID] ?? null}
                />
            </Suspense>
        </>
    );
}
