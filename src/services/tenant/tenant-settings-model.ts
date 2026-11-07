/**
 * The model of the tenant settings, Settings under Administration with more than one tenant:
 * the name and logo of the open tenant, where its own events go and what was deleted in it lately,
 * read at once so the navigation shows the state of each part.
 */

import { NotFoundError } from "@/lib/logging/errors";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { NotificationsModel } from "@/services/notifications/notification-settings-service";
import { getTenantNotificationsModel } from "@/services/notifications/tenant-notification-settings";
import { getTrashPart, type TrashViewer } from "@/services/trash/trash-service";
import type { TrashPart } from "@/services/trash/trash-types";
import { getTenantLogoInfo, type TenantLogoInfo } from "./tenant-logo-service";
import { tenantService } from "./tenant-service";
import { tenantSummaries } from "./tenant-summaries";

export interface TenantSettingsModel {
    tenant: {
        id: string;
        name: string;
        /** The home tenant, whose events go to the notifications of the platform. */
        isHome: boolean;
        logo: TenantLogoInfo | null;
        /** What the tenant switcher shows under its name. */
        jobs: number;
        databases: number;
    };
    /** Where the events of the tenant go, null for the home tenant, which the platform's notifications cover. */
    notifications: NotificationsModel | null;
    /** What Recently deleted holds of the tenant that the viewer may restore, and whether they restore. */
    trash: TrashPart;
    /** May change the tenant settings. */
    canManage: boolean;
    /** Leads to the notifications of the platform from the home tenant. */
    isPlatformAdmin: boolean;
    /** How many tenants the instance has, for the tenant switcher in the preview. */
    tenantCount: number;
}

/**
 * Reads in the scope of the request, the open tenant, so Recently deleted lists what was deleted
 * there. `trash` says who looks at it and whether they restore and delete for good.
 */
export async function getTenantSettingsModel(
    tenantId: string,
    viewer: { canManage: boolean; isPlatformAdmin: boolean; trash: TrashViewer & { canManage: boolean } }
): Promise<TenantSettingsModel> {
    const isHome = tenantId === HOME_TENANT_ID;
    const [tenant, logo, [summary], notifications, tenantCount, trash] = await Promise.all([
        tenantService.find(tenantId),
        getTenantLogoInfo(tenantId),
        tenantSummaries([tenantId]),
        isHome ? null : getTenantNotificationsModel(tenantId),
        tenantService.count(),
        // Only what the viewer may restore, so the list never offers what the server refuses.
        getTrashPart(viewer.trash),
    ]);
    if (!tenant) throw new NotFoundError("Tenant", tenantId);
    return {
        tenant: { id: tenant.id, name: tenant.name, isHome, logo, jobs: summary?.jobs ?? 0, databases: summary?.databases ?? 0 },
        notifications,
        trash,
        canManage: viewer.canManage,
        isPlatformAdmin: viewer.isPlatformAdmin,
        tenantCount,
    };
}
