import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma-tx";
import { groupPermissions, PLATFORM_ADMIN_ROLE, PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { areaChanges, knownPermissions, TENANT_GROUP_AREAS } from "@/lib/auth/permission-areas";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { MembershipActor } from "@/services/tenant/membership-service";
import { assertManagersStay, assertMembersUnchanged, managesMembers, settleProviders, type ProviderMove } from "./group-service";
import { parsePermissions } from "./users-model";

/**
 * Groups the platform makes once and gives to tenants, like a group Client for the people of every
 * customer. Each tenant one reaches has a real group linked to it (`Group.templateId`), which its
 * admins give to people and only the platform changes, renames or deletes, so the permission
 * checks of a tenant read it like any group of theirs. A change counts in every tenant at once.
 *
 * A name is used once inside a tenant. A tenant that has a group of its own by the name decides
 * nothing by itself: the platform takes that group over, its members keep it and its permissions
 * become the ones of the platform, or leaves that tenant out. A tenant the group leaves loses it,
 * its members moved to another group there or to none, or keeps it as a group of its own. Who may
 * do this is the caller's to check, see `platform-group-caps.ts`.
 */

export interface TemplateInput {
    name: string;
    permissions: readonly string[];
    /** Every tenant, the ones made later too. */
    allTenants: boolean;
    /** The tenants it reaches while it does not reach every tenant. */
    tenantIds: readonly string[];
}

/** What becomes of a tenant whose own group has the name: the platform takes it over, or the tenant stays out. */
export type ClashChoice = "takeOver" | "leaveOut";

/** What becomes of the group in a tenant it leaves: removed with its members moved to a group there or to none, or kept as the tenant's own. */
export type LeaveChoice = { keep: true } | { keep: false; moveTo: string | null };

/** The answers to the questions of `preview`, by tenant. */
export interface ReachPlan {
    clashes?: Record<string, ClashChoice>;
    leaving?: Record<string, LeaveChoice>;
}

export interface ReachPerson {
    id: string;
    name: string;
}

/** A tenant with a group of its own by the name, for the question before saving. */
export interface ReachClash {
    tenantId: string;
    tenantName: string;
    groupId: string;
    /** The group with every permission of its tenant, which nobody takes over. */
    fullAccess: boolean;
    members: ReachPerson[];
    /** What its members gain and lose when the platform takes it over. */
    added: string[];
    removed: string[];
    /** It may do more than the viewer may, so they leave the tenant out. Set by the caller, who knows the viewer. */
    beyondYou?: boolean;
}

/** A tenant the group leaves, with its members and the other groups of that tenant they could move to. */
export interface ReachLeave {
    tenantId: string;
    tenantName: string;
    groupId: string;
    members: ReachPerson[];
    groups: { id: string; name: string }[];
}

export interface ReachPreview {
    clashes: ReachClash[];
    leaving: ReachLeave[];
}

/** What a save or a delete did in each tenant, by id of the tenant, for the audit logs. */
export interface ReachReport {
    created: string[];
    takenOver: string[];
    leftOut: string[];
    removed: string[];
    kept: string[];
    /** The tenants whose group changed its name or its permissions. */
    changed: string[];
    /** The group in each tenant it touched. */
    groupIds: Record<string, string>;
}

export interface SavedTemplate {
    id: string;
    name: string;
    permissions: string[];
    allTenants: boolean;
    tenantIds: string[];
    renamedFrom?: string;
    /** The levels of the areas that moved, as the audit log keeps them. */
    areas: { area: string; from: string; to: string }[];
    report: ReachReport;
    /** The sign-in providers whose group of new people a removed group changed, for the log of the platform, never for the browser. */
    ssoProviders: ProviderMove[];
}

/**
 * Who saves or deletes, and the members they were checked for, by tenant, as `membersLeaving`
 * listed them: those of a group whose members move to another group of the tenant or out of it.
 * With `checkedEnds` such a group stops the change when someone holds it there who is not listed
 * (`assertMembersUnchanged`), like a platform admin added after the checks.
 */
export interface TemplateActor extends MembershipActor {
    checkedEnds?: Readonly<Record<string, readonly string[]>>;
}

/** Who saves or deletes, by default no platform admin, so a tenant keeps someone who manages its members. */
const NO_PLATFORM_ADMIN: TemplateActor = { platformAdmin: false };

/** The permissions a group for tenants may hold: those of a group of a tenant, never the settings of the instance. */
export const templateRights = (ids: Iterable<string>) => knownPermissions(ids).filter((permission) => !PLATFORM_PERMISSIONS.has(permission));

/** The name of the group with every permission each tenant starts with, which no group for tenants takes. */
const FULL_ACCESS_NAME = "admin";

const emptyReport = (): ReachReport => ({ created: [], takenOver: [], leftOut: [], removed: [], kept: [], changed: [], groupIds: {} });

function cleanInput(input: TemplateInput) {
    const name = input.name.trim();
    if (!name) throw new ValidationError("Give the group a name.");
    if (name.toLowerCase() === FULL_ACCESS_NAME) throw new ValidationError("Admin is the group with every permission in each tenant. Pick another name.");
    return { name, permissions: templateRights(input.permissions), allTenants: input.allTenants, tenantIds: [...new Set(input.tenantIds)] };
}

/** The tenants it reaches: every tenant, or the ones picked that exist. */
async function targetsOf(client: Pick<Tx, "tenant">, input: { allTenants: boolean; tenantIds: readonly string[] }) {
    return client.tenant.findMany({
        where: input.allTenants ? {} : { id: { in: [...input.tenantIds] } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
}

const LINKED = { id: true, tenantId: true, name: true, permissions: true, fullAccess: true } as const;

/** A linked group as `removeGroup` and the check of who manages the members read it. */
type LinkedGroup = { id: string; tenantId: string; name: string; permissions: string; fullAccess: boolean };

/** The members of groups by group, as people. */
async function membersOf(client: Pick<Tx, "tenantMembership">, groupIds: string[]): Promise<Map<string, ReachPerson[]>> {
    const rows = groupIds.length === 0 ? [] : await client.tenantMembership.findMany({
        where: { groupId: { in: groupIds } },
        select: { groupId: true, user: { select: { id: true, name: true } } },
    });
    const byGroup = new Map<string, ReachPerson[]>();
    for (const row of rows) byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), { id: row.user.id, name: row.user.name }]);
    for (const list of byGroup.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return byGroup;
}

/**
 * Takes a group out of its tenant: its members move to another group of that tenant, or out of the
 * tenant without one, like the delete of a group in its tenant, and a sign-in provider that adds
 * people to it adds them where its members go. Like that delete it never leaves the tenant without
 * someone who manages its members (`assertManagersStay`), and it returns what changed of each
 * provider for the log of the platform.
 */
async function removeGroup(tx: Tx, group: LinkedGroup, moveTo: string | null, by: TemplateActor): Promise<ProviderMove[]> {
    const target = moveTo ? await tx.group.findFirst({ where: { id: moveTo, tenantId: group.tenantId }, select: { id: true, name: true, permissions: true, fullAccess: true } }) : null;
    if (moveTo && (!target || target.id === group.id)) throw new ValidationError("The group for its members is not one of their tenant.");
    await assertManagersStay(group, !!target && managesMembers(target), by, tx);
    // Their memberships move or end here, which the caller checked for the members it listed only.
    if (by.checkedEnds) await assertMembersUnchanged(tx, group.id, by.checkedEnds[group.tenantId] ?? []);
    if (target) await tx.tenantMembership.updateMany({ where: { groupId: group.id }, data: { groupId: target.id } });
    else await tx.tenantMembership.deleteMany({ where: { groupId: group.id } });
    const providers = await settleProviders(tx, group, target ? { id: target.id, name: target.name } : null);
    await tx.group.delete({ where: { id: group.id } });
    return providers;
}

/**
 * Applies what was decided for a group in a tenant it leaves. A group with members needs an answer,
 * an empty one goes. The providers it changes go into `providers`.
 */
async function leave(tx: Tx, group: LinkedGroup, tenantName: string, name: string, choice: LeaveChoice | undefined, members: number, report: ReachReport, by: TemplateActor, providers: ProviderMove[]) {
    if (!choice && members > 0) throw new ValidationError(`Decide what happens to ${name} in ${tenantName}, people hold it there.`);
    if (choice?.keep) {
        await tx.group.update({ where: { id: group.id }, data: { templateId: null } });
        report.kept.push(group.tenantId);
    } else {
        providers.push(...await removeGroup(tx, group, choice && !choice.keep ? choice.moveTo : null, by));
        report.removed.push(group.tenantId);
    }
    report.groupIds[group.tenantId] = group.id;
}

/**
 * The tenant of the first group of a group for tenants that accounts matching `holder` hold in a
 * tenant a save or a delete leaves, whose answer is not to keep it there. Null when none.
 */
async function heldLeaving(id: string, holder: Prisma.UserWhereInput, reach: { allTenants: boolean; tenantIds: readonly string[] } | null, leaving: Record<string, LeaveChoice>): Promise<{ tenantId: string; tenantName: string } | null> {
    return runAsSystem(async () => {
        const held = await prisma.group.findMany({
            where: { templateId: id, memberships: { some: { user: holder } } },
            select: { tenantId: true },
        });
        if (held.length === 0) return null;
        const staying = reach ? new Set((await targetsOf(prisma, reach)).map((tenant) => tenant.id)) : new Set<string>();
        const lost = held.find((group) => !staying.has(group.tenantId) && !leaving[group.tenantId]?.keep);
        if (!lost) return null;
        const tenant = await prisma.tenant.findUnique({ where: { id: lost.tenantId }, select: { name: true } });
        return { tenantId: lost.tenantId, tenantName: tenant?.name ?? lost.tenantId };
    });
}

export const tenantGroupTemplates = {
    /** Every group for tenants with the tenants it reaches and its group and members in each, by name. */
    async list() {
        return runAsSystem(async () => {
            const templates = await prisma.tenantGroupTemplate.findMany({
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, permissions: true, allTenants: true, createdAt: true, updatedAt: true,
                    tenants: { select: { tenantId: true } },
                    groups: { select: { id: true, tenantId: true, memberships: { select: { user: { select: { id: true, name: true, email: true, image: true } } } } } },
                },
            });
            return templates.map((template) => ({
                id: template.id,
                name: template.name,
                permissions: templateRights(parsePermissions(template.permissions)),
                allTenants: template.allTenants,
                tenantIds: template.tenants.map((tenant) => tenant.tenantId),
                createdAt: template.createdAt,
                updatedAt: template.updatedAt,
                groups: template.groups.map((group) => ({ id: group.id, tenantId: group.tenantId, members: group.memberships.map((membership) => membership.user) })),
            }));
        });
    },

    /**
     * The groups by this name in these tenants, which a save takes over where the answer says so,
     * with what each lets its members do, for the caller to check against what the viewer may give.
     */
    async groupsNamed(name: string, tenantIds: readonly string[]): Promise<{ id: string; tenantId: string; tenantName: string; name: string; permissions: string[]; fullAccess: boolean }[]> {
        if (tenantIds.length === 0) return [];
        return runAsSystem(async () => {
            const [groups, tenants] = await Promise.all([
                prisma.group.findMany({
                    where: { tenantId: { in: [...tenantIds] }, name: name.trim() },
                    select: { id: true, tenantId: true, name: true, permissions: true, fullAccess: true },
                }),
                prisma.tenant.findMany({ where: { id: { in: [...tenantIds] } }, select: { id: true, name: true } }),
            ]);
            const tenantName = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
            return groups.map((group) => ({
                id: group.id,
                tenantId: group.tenantId,
                tenantName: tenantName.get(group.tenantId) ?? group.tenantId,
                name: group.name,
                permissions: groupPermissions(group),
                fullAccess: group.fullAccess,
            }));
        });
    },

    /**
     * The tenant of the first of its groups that a save or a delete takes away from a platform admin:
     * a group a platform admin holds in a tenant it leaves, whose answer is not to keep it there,
     * since its members move to another group or out of the tenant. Without a new reach every tenant
     * counts as left, like a delete. Null when no platform admin loses a group.
     */
    async platformAdminLeaving(id: string, reach: { allTenants: boolean; tenantIds: readonly string[] } | null, leaving: Record<string, LeaveChoice> = {}): Promise<{ tenantId: string; tenantName: string } | null> {
        return heldLeaving(id, { platformRole: PLATFORM_ADMIN_ROLE }, reach, leaving);
    },

    /** Like `platformAdminLeaving`, for the groups one account holds, so nobody moves or ends their own membership. */
    async memberLeaving(id: string, userId: string, reach: { allTenants: boolean; tenantIds: readonly string[] } | null, leaving: Record<string, LeaveChoice> = {}): Promise<{ tenantId: string; tenantName: string } | null> {
        return heldLeaving(id, { id: userId }, reach, leaving);
    },

    /**
     * The members a save or a delete moves or takes out of a tenant, by tenant: the members of its
     * group in each tenant it leaves whose answer does not keep the group there. `ends` says the
     * answer moves them to no group, which ends their membership. Without a new reach every tenant
     * counts as left, like a delete. For the caller to ask `membershipEndRefusal` of each that ends,
     * since ending a membership can hand an account over, and to pass all of them as `checkedEnds`.
     */
    async membersLeaving(id: string, reach: { allTenants: boolean; tenantIds: readonly string[] } | null, leaving: Record<string, LeaveChoice> = {}): Promise<{ tenantId: string; tenantName: string; userIds: string[]; ends: boolean }[]> {
        return runAsSystem(async () => {
            const linked = await prisma.group.findMany({
                where: { templateId: id, memberships: { some: {} } },
                select: { tenantId: true, memberships: { select: { userId: true } } },
            });
            if (linked.length === 0) return [];
            const staying = reach ? new Set((await targetsOf(prisma, reach)).map((tenant) => tenant.id)) : new Set<string>();
            const ends = (choice: LeaveChoice | undefined) => !choice || (!choice.keep && !choice.moveTo);
            const left = linked.filter((group) => !staying.has(group.tenantId) && !leaving[group.tenantId]?.keep);
            if (left.length === 0) return [];
            const names = new Map((await prisma.tenant.findMany({ where: { id: { in: left.map((group) => group.tenantId) } }, select: { id: true, name: true } })).map((tenant) => [tenant.id, tenant.name]));
            return left.map((group) => ({
                tenantId: group.tenantId,
                tenantName: names.get(group.tenantId) ?? group.tenantId,
                userIds: group.memberships.map((membership) => membership.userId),
                ends: ends(leaving[group.tenantId]),
            }));
        });
    },

    /**
     * The tenant of the first linked group the user holds in a tenant a save keeps, whose
     * permissions the save changes, so nobody changes what their own group lets them do. Null when
     * none.
     */
    async memberChanging(id: string, userId: string, input: Pick<TemplateInput, "permissions" | "allTenants" | "tenantIds">): Promise<{ tenantId: string; tenantName: string } | null> {
        return runAsSystem(async () => {
            const held = await prisma.group.findMany({
                where: { templateId: id, memberships: { some: { userId } } },
                select: { tenantId: true, permissions: true },
            });
            if (held.length === 0) return null;
            const staying = new Set((await targetsOf(prisma, input)).map((tenant) => tenant.id));
            const next = new Set(templateRights(input.permissions));
            const changes = (stored: string) => {
                const now = new Set(templateRights(parsePermissions(stored)));
                return now.size !== next.size || [...now].some((permission) => !next.has(permission));
            };
            const changed = held.find((group) => staying.has(group.tenantId) && changes(group.permissions));
            if (!changed) return null;
            const tenant = await prisma.tenant.findUnique({ where: { id: changed.tenantId }, select: { name: true } });
            return { tenantId: changed.tenantId, tenantName: tenant?.name ?? changed.tenantId };
        });
    },

    /**
     * The first group by this name in these tenants that the user holds and that is not linked to
     * this group for tenants yet, which a take-over would hand to the platform with new permissions.
     * Null when the user holds none of them.
     */
    async memberNamed(id: string | null, name: string, tenantIds: readonly string[], userId: string): Promise<{ tenantId: string; tenantName: string; name: string } | null> {
        if (tenantIds.length === 0) return null;
        return runAsSystem(async () => {
            const held = await prisma.group.findFirst({
                where: {
                    tenantId: { in: [...tenantIds] }, name: name.trim(), memberships: { some: { userId } },
                    ...(id ? { OR: [{ templateId: null }, { templateId: { not: id } }] } : {}),
                },
                select: { tenantId: true, name: true },
            });
            if (!held) return null;
            const tenant = await prisma.tenant.findUnique({ where: { id: held.tenantId }, select: { name: true } });
            return { tenantId: held.tenantId, tenantName: tenant?.name ?? held.tenantId, name: held.name };
        });
    },

    /** One group for tenants, null when it is gone. */
    async find(id: string) {
        return runAsSystem(() => prisma.tenantGroupTemplate.findUnique({
            where: { id },
            select: { id: true, name: true, permissions: true, allTenants: true, tenants: { select: { tenantId: true } } },
        })).then((template) => template && {
            id: template.id,
            name: template.name,
            permissions: templateRights(parsePermissions(template.permissions)),
            allTenants: template.allTenants,
            tenantIds: template.tenants.map((tenant) => tenant.tenantId),
        });
    },

    /**
     * What a save asks before it goes through: the tenants it newly reaches that have a group of
     * their own by the name, and the tenants it leaves where people hold it. A rename onto the name
     * of a group a reached tenant has already is refused, there is nothing to choose there.
     */
    async preview(id: string | null, input: TemplateInput): Promise<ReachPreview> {
        const clean = cleanInput(input);
        return runAsSystem(async () => {
            const [targets, linked] = await Promise.all([
                targetsOf(prisma, clean),
                id ? prisma.group.findMany({ where: { templateId: id }, select: LINKED }) : Promise.resolve([]),
            ]);
            const targetIds = new Set(targets.map((tenant) => tenant.id));
            const linkedTenants = new Set(linked.map((group) => group.tenantId));
            const fresh = targets.filter((tenant) => !linkedTenants.has(tenant.id));
            const leaving = linked.filter((group) => !targetIds.has(group.tenantId));
            const own = fresh.length === 0 ? [] : await prisma.group.findMany({
                where: { tenantId: { in: fresh.map((tenant) => tenant.id) }, name: clean.name, templateId: null },
                select: { id: true, tenantId: true, permissions: true, fullAccess: true },
            });
            const [members, others, names] = await Promise.all([
                membersOf(prisma, [...own.map((group) => group.id), ...leaving.map((group) => group.id)]),
                leaving.length === 0 ? Promise.resolve([]) : prisma.group.findMany({
                    where: { tenantId: { in: leaving.map((group) => group.tenantId) }, templateId: null },
                    select: { id: true, name: true, tenantId: true },
                    orderBy: { name: "asc" },
                }),
                prisma.tenant.findMany({ where: { id: { in: [...own.map((group) => group.tenantId), ...leaving.map((group) => group.tenantId)] } }, select: { id: true, name: true } }),
            ]);
            const nameOf = new Map(names.map((tenant) => [tenant.id, tenant.name]));
            const wanted = new Set<string>(clean.permissions);
            return {
                clashes: own.map((group) => {
                    const held = new Set(parsePermissions(group.permissions));
                    return {
                        tenantId: group.tenantId,
                        tenantName: nameOf.get(group.tenantId) ?? group.tenantId,
                        groupId: group.id,
                        fullAccess: group.fullAccess,
                        members: members.get(group.id) ?? [],
                        added: clean.permissions.filter((permission) => !held.has(permission)),
                        removed: [...held].filter((permission) => !wanted.has(permission)),
                    };
                }).sort((a, b) => a.tenantName.localeCompare(b.tenantName)),
                leaving: leaving.map((group) => ({
                    tenantId: group.tenantId,
                    tenantName: nameOf.get(group.tenantId) ?? group.tenantId,
                    groupId: group.id,
                    members: members.get(group.id) ?? [],
                    groups: others.filter((other) => other.tenantId === group.tenantId).map(({ id: groupId, name }) => ({ id: groupId, name })),
                })).sort((a, b) => a.tenantName.localeCompare(b.tenantName)),
            };
        });
    },

    /**
     * Makes a group for tenants, or saves one, with the answers to the questions of `preview`. A
     * reached tenant without the group gets one, a tenant it leaves loses it or keeps it as its
     * own, and every linked group takes the name and the permissions. All of it or nothing. Unless
     * `by` is a platform admin, no tenant is left without someone who manages its members.
     */
    async save(id: string | null, input: TemplateInput, plan: ReachPlan = {}, by: TemplateActor = NO_PLATFORM_ADMIN): Promise<SavedTemplate> {
        const clean = cleanInput(input);
        return runAsSystem(() => prisma.$transaction(async (tx) => {
            const clash = await tx.tenantGroupTemplate.findFirst({ where: { name: clean.name }, select: { id: true } });
            if (clash && clash.id !== id) throw new ValidationError(`A group for tenants with the name "${clean.name}" already exists.`);
            const before = id ? await tx.tenantGroupTemplate.findUnique({ where: { id }, select: { name: true, permissions: true } }) : null;
            if (id && !before) throw new NotFoundError("Group for tenants", id);

            const permissions = JSON.stringify(clean.permissions);
            const template = id
                ? await tx.tenantGroupTemplate.update({ where: { id }, data: { name: clean.name, permissions, allTenants: clean.allTenants }, select: { id: true } })
                : await tx.tenantGroupTemplate.create({ data: { name: clean.name, permissions, allTenants: clean.allTenants }, select: { id: true } });

            const targets = await targetsOf(tx, clean);
            const targetIds = new Set(targets.map((tenant) => tenant.id));
            const tenantName = new Map((await tx.tenant.findMany({ select: { id: true, name: true } })).map((tenant) => [tenant.id, tenant.name]));
            const linked = await tx.group.findMany({ where: { templateId: template.id }, select: LINKED });
            const report = emptyReport();
            const ssoProviders: ProviderMove[] = [];
            const manages = clean.permissions.includes(PERMISSIONS.USERS.WRITE);

            // The tenants it leaves.
            const leaving = linked.filter((group) => !targetIds.has(group.tenantId));
            const leavingMembers = await membersOf(tx, leaving.map((group) => group.id));
            for (const group of leaving) {
                await leave(tx, group, tenantName.get(group.tenantId) ?? group.tenantId, clean.name, plan.leaving?.[group.tenantId], leavingMembers.get(group.id)?.length ?? 0, report, by, ssoProviders);
            }

            // The tenants it stays in take the name and the permissions.
            const staying = linked.filter((group) => targetIds.has(group.tenantId));
            const renamed = staying.filter((group) => group.name !== clean.name);
            if (renamed.length > 0) {
                const taken = await tx.group.findMany({
                    where: { tenantId: { in: renamed.map((group) => group.tenantId) }, name: clean.name, OR: [{ templateId: null }, { templateId: { not: template.id } }] },
                    select: { tenantId: true },
                });
                if (taken.length > 0) {
                    const where = taken.map((group) => tenantName.get(group.tenantId) ?? group.tenantId).sort().join(", ");
                    throw new ValidationError(`${where} ${taken.length === 1 ? "has" : "have"} a group named ${clean.name} already. Pick another name.`);
                }
            }
            for (const group of staying) {
                if (group.name === clean.name && group.permissions === permissions) continue;
                await assertManagersStay(group, manages, by, tx);
                await tx.group.update({ where: { id: group.id }, data: { name: clean.name, permissions } });
                report.changed.push(group.tenantId);
                report.groupIds[group.tenantId] = group.id;
            }

            // The tenants it newly reaches: a group of their own by the name is taken over or the tenant stays out.
            const fresh = targets.filter((tenant) => !staying.some((group) => group.tenantId === tenant.id));
            const own = fresh.length === 0 ? [] : await tx.group.findMany({
                where: { tenantId: { in: fresh.map((tenant) => tenant.id) }, name: clean.name },
                select: { id: true, tenantId: true, permissions: true, fullAccess: true },
            });
            for (const tenant of fresh) {
                const existing = own.find((group) => group.tenantId === tenant.id);
                if (!existing) {
                    const group = await tx.group.create({ data: { tenantId: tenant.id, name: clean.name, permissions, templateId: template.id }, select: { id: true } });
                    report.created.push(tenant.id);
                    report.groupIds[tenant.id] = group.id;
                    continue;
                }
                const choice = plan.clashes?.[tenant.id];
                if (!choice) throw new ValidationError(`${tenant.name} has a group named ${clean.name}. Take it over or leave ${tenant.name} out.`);
                if (choice === "leaveOut") {
                    report.leftOut.push(tenant.id);
                    continue;
                }
                if (existing.fullAccess) throw new ValidationError(`${clean.name} holds every permission of ${tenant.name} and stays its own. Leave ${tenant.name} out.`);
                await assertManagersStay(existing, manages, by, tx);
                await tx.group.update({ where: { id: existing.id }, data: { templateId: template.id, permissions } });
                report.takenOver.push(tenant.id);
                report.groupIds[tenant.id] = existing.id;
            }

            // The tenants it reaches, while it does not reach every tenant: the ones picked, without those left out.
            const tenantIds = clean.allTenants ? [] : targets.map((tenant) => tenant.id).filter((tenantId) => !report.leftOut.includes(tenantId));
            await tx.tenantGroupTemplateTenant.deleteMany({ where: { templateId: template.id } });
            if (tenantIds.length > 0) await tx.tenantGroupTemplateTenant.createMany({ data: tenantIds.map((tenantId) => ({ templateId: template.id, tenantId })) });

            const beforeHeld = new Set(before ? parsePermissions(before.permissions) : []);
            return {
                id: template.id,
                name: clean.name,
                permissions: clean.permissions,
                allTenants: clean.allTenants,
                tenantIds,
                ...(before && before.name !== clean.name ? { renamedFrom: before.name } : {}),
                areas: areaChanges(beforeHeld, new Set(clean.permissions), TENANT_GROUP_AREAS).map((change) => ({ area: change.area.id, from: change.from, to: change.to })),
                report,
                ssoProviders,
            };
        }));
    },

    /**
     * Deletes a group for tenants. Its group in each tenant goes, its members moved to a group there
     * or to none, or stays as a group of that tenant, as decided by tenant. A group with members
     * needs an answer, an empty one goes. Unless `by` is a platform admin, no tenant is left without
     * someone who manages its members.
     */
    async remove(id: string, leaving: Record<string, LeaveChoice> = {}, by: TemplateActor = NO_PLATFORM_ADMIN): Promise<{ name: string; report: ReachReport; ssoProviders: ProviderMove[] }> {
        return runAsSystem(() => prisma.$transaction(async (tx) => {
            const template = await tx.tenantGroupTemplate.findUnique({ where: { id }, select: { name: true } });
            if (!template) throw new NotFoundError("Group for tenants", id);
            const linked = await tx.group.findMany({ where: { templateId: id }, select: LINKED });
            const tenantName = new Map((await tx.tenant.findMany({ where: { id: { in: linked.map((group) => group.tenantId) } }, select: { id: true, name: true } })).map((tenant) => [tenant.id, tenant.name]));
            const members = await membersOf(tx, linked.map((group) => group.id));
            const report = emptyReport();
            const ssoProviders: ProviderMove[] = [];
            for (const group of linked) {
                await leave(tx, group, tenantName.get(group.tenantId) ?? group.tenantId, template.name, leaving[group.tenantId], members.get(group.id)?.length ?? 0, report, by, ssoProviders);
            }
            await tx.tenantGroupTemplate.delete({ where: { id } });
            return { name: template.name, report, ssoProviders };
        }));
    },
};

/** Gives a new tenant the groups for every tenant, inside the transaction that creates it, and says which names they took. */
export async function seedTemplateGroups(tx: Tx, tenantId: string): Promise<Set<string>> {
    const templates = await tx.tenantGroupTemplate.findMany({ where: { allTenants: true }, select: { id: true, name: true, permissions: true } });
    for (const template of templates) {
        await tx.group.create({ data: { tenantId, name: template.name, permissions: JSON.stringify(templateRights(parsePermissions(template.permissions))), templateId: template.id } });
    }
    return new Set(templates.map((template) => template.name));
}
