import prisma from "@/lib/prisma";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { tenantLine } from "@/lib/auth/platform-group-summary";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { peopleOf } from "@/services/tenant/membership-service";
import { parsePermissions } from "./users-model";

/**
 * Who of the MSP opens a tenant through the platform without being a member there: the platform
 * admins and the members of each platform group whose scope reaches the tenant. A tenant's Users
 * tab shows them read only, so its admins know who else may look in. No secret, no right on the
 * platform, only who and what they may do there.
 */

export interface PlatformPerson {
    id: string;
    name: string;
    email: string;
    image: string | null;
}

export interface PlatformPeopleGroup {
    id: string;
    name: string;
    /** Platform admin, which holds every right. */
    builtIn: boolean;
    /** What its members may do in the tenant, in one line. */
    line: string;
    members: PlatformPerson[];
}

export interface PlatformPeople {
    /** The name of the home tenant, whose people they are. */
    home: string;
    /** Platform admin first, then the groups by name, only those with someone in them. */
    groups: PlatformPeopleGroup[];
}

const PERSON = { id: true, name: true, email: true, image: true } as const;

/**
 * The people of the MSP who open the tenant through the platform. None while the instance has one
 * tenant. The people of the tenant itself are left out, its Users tab lists them already, in the
 * home tenant the accounts of no tenant too.
 */
export async function platformPeopleOf(tenantId: string): Promise<PlatformPeople> {
    const outside = { NOT: peopleOf(tenantId) };
    return runAsSystem(async () => {
        const [tenants, home, admins, groups] = await Promise.all([
            prisma.tenant.count(),
            prisma.tenant.findUnique({ where: { id: HOME_TENANT_ID }, select: { name: true } }),
            prisma.user.findMany({ where: { platformRole: PLATFORM_ADMIN_ROLE, ...outside }, select: PERSON, orderBy: { name: "asc" } }),
            prisma.platformGroup.findMany({
                where: { OR: [{ allTenants: true }, { tenants: { some: { tenantId } } }] },
                select: { id: true, name: true, tenantPermissions: true, members: { where: outside, select: PERSON, orderBy: { name: "asc" } } },
                orderBy: { name: "asc" },
            }),
        ]);
        if (tenants <= 1) return { home: home?.name ?? "the platform", groups: [] };
        return {
            home: home?.name ?? "the platform",
            groups: [
                ...(admins.length > 0 ? [{ id: "platform-admin", name: "Platform admin", builtIn: true, line: "Everything", members: admins }] : []),
                ...groups
                    .filter((group) => group.members.length > 0)
                    .map((group) => ({ id: group.id, name: group.name, builtIn: false, line: tenantLine(parsePermissions(group.tenantPermissions)), members: group.members })),
            ],
        };
    });
}
