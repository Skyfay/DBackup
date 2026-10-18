import prisma from "@/lib/prisma";
import { capToOwner, ownerPermissionsIn, permissionsIn, PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAsSystem } from "@/lib/tenant/context";

/**
 * Whether the maker of a download link may still download in its tenant when the link is used. A
 * link is fetched without a session, so nothing checks a permission at that moment but this: an
 * account through its groups in the tenant now, a platform admin in any tenant that exists, and an
 * API key through what it holds and its owner may now, while it is on, not expired and its tenant
 * still allows API keys, like `apiKeyService.validate`.
 */

/** The maker of a link, as the link keeps it. */
export interface DownloadMaker {
    userId: string;
    tenantId: string;
    /** The API key the link was made with, none for a session. */
    apiKeyId?: string;
}

const OWNER = {
    platformRole: true,
    memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } },
    platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } },
} as const;

export async function makerMayDownload(maker: DownloadMaker): Promise<boolean> {
    return runAsSystem(async () => {
        const [user, tenant] = await Promise.all([
            prisma.user.findUnique({ where: { id: maker.userId }, select: OWNER }),
            prisma.tenant.findUnique({ where: { id: maker.tenantId }, select: { addsApiKeys: true, sharesWithCustomers: true } }),
        ]);
        if (!user || !tenant) return false;
        if (!maker.apiKeyId) {
            if (user.platformRole === PLATFORM_ADMIN_ROLE) return true;
            return permissionsIn(user.memberships, maker.tenantId, user.platformGroup).includes(PERMISSIONS.STORAGE.DOWNLOAD);
        }
        const key = await prisma.apiKey.findUnique({ where: { id: maker.apiKeyId }, select: { userId: true, tenantId: true, enabled: true, expiresAt: true, permissions: true } });
        if (!key || key.userId !== maker.userId || key.tenantId !== maker.tenantId || !key.enabled || !tenant.addsApiKeys) return false;
        if (key.expiresAt && key.expiresAt < new Date()) return false;
        let held: string[];
        try {
            held = JSON.parse(key.permissions) as string[];
        } catch {
            return false;
        }
        return capToOwner(held, ownerPermissionsIn(user, maker.tenantId, tenant.sharesWithCustomers)).includes(PERMISSIONS.STORAGE.DOWNLOAD);
    });
}
