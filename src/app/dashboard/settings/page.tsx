import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RecentlyDeletedEveryTenant } from "@/components/dashboard/settings/recently-deleted-frame";
import { settingsRoute } from "@/components/dashboard/settings/settings-address";
import { TenantSettingsClient } from "@/components/dashboard/tenant-settings/tenant-settings-client";
import { PickTenantPanel } from "@/components/tenant/tenant-pick";
import { getViewer, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { getTenantSettingsModel } from "@/services/tenant/tenant-settings-model";
import { tenantService } from "@/services/tenant/tenant-service";
import { getTrashPart } from "@/services/trash/trash-service";
import { PlatformSettingsView } from "../platform/settings/platform-settings-view";
import { firstOf, queryOf, type PageSearchParams } from "../search-params";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Settings" };

/**
 * Settings under Administration. With one tenant, every install before tenants, the settings of
 * the instance with Recently deleted. With more, the settings of the open tenant: its name and
 * logo, where its own events go and Recently deleted, while the instance's are Platform settings.
 * An old link to a part of the instance's lands there. All tenants asks for a tenant and lists
 * what was deleted in every tenant below, read only.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
    const params = await searchParams;
    const tenantCount = await tenantService.count();
    const route = settingsRoute({ several: tenantCount > 1, part: firstOf(params, "part"), tab: firstOf(params, "tab"), query: queryOf(params) });
    if (route.kind === "redirect") redirect(route.to);
    if (route.kind === "platform") return <PlatformSettingsView tenantCount={tenantCount} />;

    const viewer = await getViewer();
    if (!viewer) redirect("/");
    // All tenants changes no tenant, so it asks which one to open the settings of, with what was
    // deleted in every tenant below, where each entry opens its tenant to restore it.
    if (viewer.allTenants) {
        const part = firstOf(params, "part");
        const trash = hasPermissionWithContext(viewer, PERMISSIONS.TENANT_SETTINGS.READ)
            ? await getTrashPart({ permissions: viewer.permissions, isPlatformAdmin: viewer.isPlatformAdmin, canManage: false })
            : null;
        return (
            <div className="space-y-4 md:space-y-6">
                <h1 className="sr-only">Tenant settings</h1>
                <PickTenantPanel
                    title="Tenant settings"
                    description="The name, the logo, the notifications and Recently deleted belong to one tenant. Pick the tenant to open them in."
                    href={part ? `/dashboard/settings?part=${encodeURIComponent(part)}` : "/dashboard/settings"}
                />
                {trash && <RecentlyDeletedEveryTenant trash={trash} />}
            </div>
        );
    }
    if (!viewer.tenantId || !hasPermissionWithContext(viewer, PERMISSIONS.TENANT_SETTINGS.READ)) redirect("/dashboard");

    const model = await getTenantSettingsModel(viewer.tenantId, {
        canManage: hasPermissionWithContext(viewer, PERMISSIONS.TENANT_SETTINGS.WRITE),
        isPlatformAdmin: viewer.isPlatformAdmin,
        trash: { permissions: viewer.permissions, isPlatformAdmin: viewer.isPlatformAdmin, canManage: hasPermissionWithContext(viewer, TRASH_ADMIN_PERMISSION) },
    });

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Settings of {model.tenant.name}</h1>
            <TenantSettingsClient model={model} />
        </>
    );
}
