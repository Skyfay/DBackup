import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { currentTenantId } from "@/lib/tenant/current";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { ALLOWANCE_KINDS, ALLOWANCE_NOUNS, type AllowanceKind, type TenantAllowances } from "@/lib/tenant/allowances";

/**
 * What a tenant may add itself, which the platform decides: database connections, directory
 * sources, destinations and notification channels. Switching one off stops new ones, the ones the
 * tenant has keep working and stay its own. A tenant that adds no destinations writes to those a
 * tenant of the MSP shares with it.
 */

const COLUMNS: Record<AllowanceKind, "addsDatabases" | "addsDirectorySources" | "addsDestinations" | "addsChannels" | "addsApiKeys"> = {
    databases: "addsDatabases",
    directorySources: "addsDirectorySources",
    destinations: "addsDestinations",
    channels: "addsChannels",
    apiKeys: "addsApiKeys",
};

const SELECT = { name: true, addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true } as const;

type AllowanceRow = { [K in (typeof COLUMNS)[AllowanceKind]]: boolean };

export function allowancesOfRow(row: AllowanceRow): TenantAllowances {
    return Object.fromEntries(ALLOWANCE_KINDS.map((kind) => [kind, row[COLUMNS[kind]]])) as TenantAllowances;
}

/** The kind of connection a type and a role of a new connection are, null for none a limit covers. */
export function allowanceKindOf(type: string, storageRole?: string | null): AllowanceKind | null {
    if (type === "database") return "databases";
    if (type === "notification") return "channels";
    if (type === "storage") return storageRole === STORAGE_ROLES.SOURCE ? "directorySources" : "destinations";
    return null;
}

/**
 * Refuses something of a kind the tenant that runs now may not add itself: a connection or an API
 * key. Outside a tenant, like the configuration restore of the platform, nothing is refused.
 */
export async function assertMayAddKind(kind: AllowanceKind): Promise<void> {
    const tenantId = await currentTenantId();
    if (!tenantId) return;
    const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: SELECT });
    if (!row || allowancesOfRow(row)[kind]) return;
    const platform = (await prisma.tenant.findUnique({ where: { id: HOME_TENANT_ID }, select: { name: true } }))?.name ?? "The platform";
    if (kind === "apiKeys") throw new ValidationError(`${row.name} makes no API keys. ${platform} decides that.`);
    throw new ValidationError(`${row.name} adds no ${ALLOWANCE_NOUNS[kind]} of its own. ${platform} decides that, ask them for one.`);
}

/** Refuses a new connection of a kind the tenant that runs now may not add itself, see `assertMayAddKind`. */
export async function assertMayAdd(type: string, storageRole?: string | null): Promise<void> {
    const kind = allowanceKindOf(type, storageRole);
    if (kind) await assertMayAddKind(kind);
}

/** Changes what a tenant may add itself. The home tenant holds what the platform owns and adds what it needs. */
export async function setAllowances(id: string, patch: Partial<TenantAllowances>): Promise<{ name: string; before: TenantAllowances; after: TenantAllowances }> {
    if (id === HOME_TENANT_ID) throw new ValidationError("The home tenant holds what the platform owns and adds what it needs.");
    const row = await prisma.tenant.findUnique({ where: { id }, select: SELECT });
    if (!row) throw new NotFoundError("Tenant", id);
    const before = allowancesOfRow(row);
    const after = { ...before, ...Object.fromEntries(ALLOWANCE_KINDS.filter((kind) => typeof patch[kind] === "boolean").map((kind) => [kind, patch[kind]])) } as TenantAllowances;
    await prisma.tenant.update({ where: { id }, data: Object.fromEntries(ALLOWANCE_KINDS.map((kind) => [COLUMNS[kind], after[kind]])) });
    return { name: row.name, before, after };
}
