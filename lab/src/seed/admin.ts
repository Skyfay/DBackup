/**
 * The first user of a fresh dev database, made the way the first sign-up makes it: through Better
 * Auth, so the password hash, the credential account and the verified email are the real thing.
 */

import prisma from "@/lib/prisma";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { ensureFullAccessGroup } from "@/services/user/group-service";
import { userService } from "@/services/user/user-service";

/** Creates the first user unless the database has users already. Returns what it did. */
export async function ensureAdmin(admin: { name: string; email: string; password: string }): Promise<"created" | "kept"> {
    if ((await prisma.user.count()) > 0) return "kept";
    // The app makes it on the first visit of the dashboard of the first user, which only works while
    // that user is the only one. Making it before the user keeps the seed independent of that.
    const groupId = await ensureFullAccessGroup();
    const user = await userService.createUser({ name: admin.name, email: admin.email, password: admin.password, groupId, tenantId: HOME_TENANT_ID });
    await prisma.user.update({ where: { id: user.id }, data: { platformRole: PLATFORM_ADMIN_ROLE } });
    return "created";
}
