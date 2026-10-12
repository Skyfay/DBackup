/**
 * The first user of a fresh dev database, made the way the first sign-up makes it: through Better
 * Auth, so the password hash, the credential account and the verified email are the real thing.
 */

import prisma from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { userService } from "@/services/user/user-service";

const SUPER_ADMIN = "SuperAdmin";

/**
 * The SuperAdmin group with every permission. The app makes it on the first visit of the
 * dashboard of the first user, which only works while that user is the only one. Making it before
 * the user keeps the seed independent of that.
 */
async function ensureSuperAdminGroup(): Promise<string> {
    const permissions = JSON.stringify(Object.values(PERMISSIONS).flatMap((group) => Object.values(group)));
    const group = await prisma.group.upsert({
        where: { name: SUPER_ADMIN },
        update: { permissions },
        create: { name: SUPER_ADMIN, permissions },
    });
    return group.id;
}

/** Creates the first user unless the database has users already. Returns what it did. */
export async function ensureAdmin(admin: { name: string; email: string; password: string }): Promise<"created" | "kept"> {
    if ((await prisma.user.count()) > 0) return "kept";
    const groupId = await ensureSuperAdminGroup();
    await userService.createUser({ name: admin.name, email: admin.email, password: admin.password, groupId });
    return "created";
}
