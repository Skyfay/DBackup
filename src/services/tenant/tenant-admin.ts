import type { AuthContext } from "@/lib/auth/access-control";
import { reachCovers, type PlatformReach } from "@/lib/auth/platform-group-caps";
import { diffFields } from "@/lib/core/audit-diff";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, PermissionError, ValidationError } from "@/lib/logging/errors";
import { ALLOWANCE_KINDS, ALLOWANCE_NOUNS, type TenantAllowances } from "@/lib/tenant/allowances";
import { ALL_TENANTS, HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService, type AuditOrigin } from "@/services/audit-service";
import { setAllowances } from "@/services/tenant/tenant-allowances";
import { isEmptyTenant, tenantContents, type TenantContents } from "@/services/tenant/tenant-contents";
import { setNetwork, type TenantNetwork } from "@/services/tenant/tenant-network";
import { tenantOnDemandService } from "@/services/tenant/tenant-on-demand";
import { tenantService, type TenantRow } from "@/services/tenant/tenant-service";
import { tenantSummaries, type TenantSummary } from "@/services/tenant/tenant-summaries";
import { platformGroupService } from "@/services/user/platform-group-service";

/**
 * The platform looks after its tenants: creates, renames and deletes them and decides what they
 * share, add and reach. Platform > Tenants and `/api/tenants` both come through here, so a rule
 * holds the same for a person in the browser and for an API key. The caller checked the right
 * (`platform-tenants:*`), this module checks the reach and writes the audit entries.
 */

/** Who looks after the tenants: a person, or the owner of an API key. */
export interface TenantAdminActor {
    /** The account that acts, the owner of an API key. */
    id: string;
    /** A platform admin with a session. An API key never acts as one, the reach of its owner decides instead. */
    isPlatformAdmin: boolean;
    /** The tenant the actor works in, the tenant of an API key. Null in All tenants. */
    tenantId: string | null;
    /** The API key of the request, which every audit entry names. */
    apiKeyId?: string | null;
    /**
     * The tenants the actor looks after, see `platformGroupService.reachOf`. A route reads it once.
     * Left out, every check asks the platform group of the actor.
     */
    reach?: PlatformReach;
}

export const TENANT_GONE = "The tenant no longer exists.";
export const CREATE_BEYOND_REACH = "Your platform group reaches some tenants only, so a new one would be out of your reach. A platform admin creates it.";
export const DELETE_OWN_TENANT = "You work in this tenant. Open another one first.";

/** A tenant that is gone or beyond the actor, which read the same, so nobody learns of a tenant they may not see. */
export class TenantGoneError extends NotFoundError {
    constructor(tenantId: string) {
        super("Tenant", tenantId);
        this.message = TENANT_GONE;
    }
}

/** Something the actor may not do in a tenant they reach, in a sentence they can act on. */
export class TenantAdminRefusal extends PermissionError {
    constructor(message: string) {
        super("platform-tenants:write", { message });
    }
}

/** The actor of an API route: the person of the session or the owner of the key, with their reach read once. */
export async function routeActor(ctx: Pick<AuthContext, "userId" | "isPlatformAdmin" | "tenantId" | "authMethod" | "apiKeyId">): Promise<TenantAdminActor> {
    return {
        id: ctx.userId,
        isPlatformAdmin: ctx.isPlatformAdmin,
        tenantId: ctx.tenantId,
        apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null,
        reach: await platformGroupService.reachOf(ctx.userId),
    };
}

/** The log of the home tenant, where a change of the tenants belongs, naming the API key of the request. */
export const platformOrigin = (actor: Pick<TenantAdminActor, "apiKeyId">): AuditOrigin => ({ tenantId: HOME_TENANT_ID, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}) });

/** The log of one tenant, which learns of a change the platform made to it. */
export const tenantOrigin = (actor: Pick<TenantAdminActor, "apiKeyId">, tenantId: string): AuditOrigin => ({ tenantId, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}) });

/**
 * Whether the actor looks after this tenant: a platform admin every tenant, anyone else, and the
 * key of anyone, the tenants their platform group reaches. A membership gives no right on the platform.
 */
export async function managesTenant(actor: TenantAdminActor, tenantId: string): Promise<boolean> {
    if (actor.isPlatformAdmin) return true;
    if (actor.reach) return reachCovers(actor.reach, tenantId);
    return platformGroupService.reaches(actor.id, tenantId);
}

/** Refuses a tenant the actor does not look after as gone. */
export async function assertManages(actor: TenantAdminActor, tenantId: string): Promise<void> {
    if (!(await managesTenant(actor, tenantId))) throw new TenantGoneError(tenantId);
}

/** Whether the actor reaches a new tenant: only a platform admin and whoever reaches every tenant. */
export async function mayCreateTenants(actor: TenantAdminActor): Promise<boolean> {
    if (actor.isPlatformAdmin) return true;
    if (actor.reach) return actor.reach === "all";
    return platformGroupService.reachesAll(actor.id);
}

/** A tenant as `GET /api/tenants` lists it: the row of Platform > Tenants with the numbers of its summary. */
export type TenantListEntry = TenantRow & Pick<TenantSummary, "databases" | "health">;

/** The tenants the actor looks after, with the fields of Platform > Tenants, the home tenant first. */
export async function tenantsFor(actor: TenantAdminActor): Promise<TenantListEntry[]> {
    const all = await tenantService.list();
    const reached: TenantRow[] = [];
    for (const tenant of all) if (await managesTenant(actor, tenant.id)) reached.push(tenant);
    const summaries = new Map((await tenantSummaries(reached.map((tenant) => tenant.id))).map((summary) => [summary.id, summary]));
    return reached.map((tenant) => ({ ...tenant, databases: summaries.get(tenant.id)?.databases ?? 0, health: summaries.get(tenant.id)?.health ?? null }));
}

/** One tenant the actor looks after, like `tenantsFor` lists it. */
export async function tenantFor(actor: TenantAdminActor, tenantId: string): Promise<TenantListEntry> {
    await assertManages(actor, tenantId);
    const tenant = (await tenantService.list()).find((row) => row.id === tenantId);
    if (!tenant) throw new TenantGoneError(tenantId);
    const [summary] = await tenantSummaries([tenant.id]);
    return { ...tenant, databases: summary?.databases ?? 0, health: summary?.health ?? null };
}

/** Creates a tenant with the built-in templates. A tenant of the MSP that shares with customers says so from the start. */
export async function createTenantAs(actor: TenantAdminActor, name: string, sharesWithCustomers = false) {
    // A platform group of some tenants would never reach the tenant it made.
    if (!(await mayCreateTenants(actor))) throw new TenantAdminRefusal(CREATE_BEYOND_REACH);
    const tenant = await tenantService.create(name, sharesWithCustomers);
    await auditService.log(actor.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.TENANT, { name: tenant.name, ...(sharesWithCustomers ? { sharesWithCustomers } : {}) }, tenant.id, platformOrigin(actor));
    return tenant;
}

export async function renameTenantAs(actor: TenantAdminActor, tenantId: string, name: string) {
    await assertManages(actor, tenantId);
    const change = await tenantService.rename(tenantId, name);
    if (change.name !== change.renamedFrom) {
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, renamedFrom: change.renamedFrom }, tenantId, platformOrigin(actor));
    }
    return change;
}

/** Switches whether a tenant shares its databases, destinations and channels with customers. */
export async function setTenantSharingAs(actor: TenantAdminActor, tenantId: string, on: boolean) {
    await assertManages(actor, tenantId);
    const change = await tenantService.setSharing(tenantId, on);
    if (change.changed) {
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, change: on ? "Shares with customers" : "Shares nothing with customers" }, tenantId, platformOrigin(actor));
    }
    return change;
}

/** Sets what a tenant adds itself. What it has keeps working. */
export async function setTenantAllowancesAs(actor: TenantAdminActor, tenantId: string, patch: Partial<TenantAllowances>) {
    await assertManages(actor, tenantId);
    const change = await setAllowances(tenantId, patch);
    const changes = ALLOWANCE_KINDS.filter((kind) => change.before[kind] !== change.after[kind])
        .map((kind) => ({ field: `Adds ${ALLOWANCE_NOUNS[kind]}`, from: change.before[kind] ? "Yes" : "No", to: change.after[kind] ? "Yes" : "No" }));
    if (changes.length > 0) {
        // The platform's change, and one the tenant learns of in its own log.
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId, platformOrigin(actor));
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId, tenantOrigin(actor, tenantId));
    }
    return change;
}

/** The setting of the network as the audit log shows it. */
const networkWords = (network: TenantNetwork) => ({ blocks: network.blocks ? "Blocked" : "Reached", allowed: network.allowed });
const NETWORK_FIELDS = { blocks: { label: "Local network" }, allowed: { label: "Allowed ranges" } };

/**
 * Sets whether the connections of a tenant reach the local network of the server DBackup runs on,
 * and the ranges they reach anyway. Never for the home tenant, which is the platform, nor for All
 * tenants, which is no tenant.
 */
export async function setTenantNetworkAs(actor: TenantAdminActor, tenantId: string, network: TenantNetwork) {
    if (tenantId === ALL_TENANTS) throw new ValidationError("All tenants is no tenant of its own. Pick the tenant to change.");
    if (tenantId === HOME_TENANT_ID) throw new ValidationError("The home tenant is the platform and reaches the network of its server.");
    await assertManages(actor, tenantId);
    const change = await setNetwork(tenantId, network);
    const changes = diffFields(networkWords(change.before), networkWords(change.after), NETWORK_FIELDS);
    if (changes.length > 0) {
        // The platform's change, and one the tenant learns of in its own log.
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId, platformOrigin(actor));
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId, tenantOrigin(actor, tenantId));
    }
    return change;
}

const onDemandWords = (perDay: number | null) => (perDay === null ? "Off" : perDay === 0 ? "Off here" : `${perDay} a day`);

/** Sets how many backups a day a customer may start of every database given to it, none with null. */
export async function setTenantOnDemandAs(actor: TenantAdminActor, tenantId: string, perDay: number | null) {
    await assertManages(actor, tenantId);
    const change = await tenantOnDemandService.set(tenantId, perDay);
    if (change.before !== change.after) {
        const changes = diffFields({ perDay: onDemandWords(change.before) }, { perDay: onDemandWords(change.after) }, { perDay: { label: "Backups on demand" } });
        // The platform's change, and one the tenant learns of in its own log, which is the same log for the home tenant.
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId, platformOrigin(actor));
        if (tenantId !== HOME_TENANT_ID) {
            await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId, tenantOrigin(actor, tenantId));
        }
    }
    return change;
}

/** Why the actor may not delete a tenant, null when they may: never the one they work in, never one beyond them. */
export async function deleteRefusal(actor: TenantAdminActor, tenantId: string): Promise<string | null> {
    if (tenantId === actor.tenantId) return DELETE_OWN_TENANT;
    if (!(await managesTenant(actor, tenantId))) return TENANT_GONE;
    return null;
}

/**
 * Deletes a tenant with everything it holds and writes it into the log of the platform, and what
 * its customers lost into theirs. The caller asked `deleteRefusal` first.
 */
export async function removeTenantAs(actor: TenantAdminActor, tenantId: string) {
    const { withdrawn = [], ...removal } = await tenantService.delete(tenantId);
    await auditService.log(actor.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.TENANT, { ...removal }, tenantId, platformOrigin(actor));
    // Each customer of what it shared learns in its own log what it lost with it.
    for (const loss of withdrawn) {
        await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, loss.kind === "destination" ? AUDIT_RESOURCES.DESTINATION : AUDIT_RESOURCES.ADAPTER, {
            name: loss.name,
            action: "unshare",
            ...(loss.jobs.length > 0 ? { jobs: loss.jobs } : {}),
            ...(loss.templates.length > 0 ? { templates: loss.templates } : {}),
        }, loss.configId, tenantOrigin(actor, loss.tenantId));
    }
    return removal;
}

/** A tenant that holds something a delete takes along, which Delete asks about first. */
export class TenantNotEmptyError extends ConflictError {
    constructor(readonly contents: TenantContents) {
        super("The tenant holds connections, jobs or people, or keys, API keys or entries in Recently deleted, which go with it. Send confirmed to delete it anyway.");
    }
}

/**
 * Deletes a tenant like Delete on Platform > Tenants: never the one the actor works in nor one
 * beyond them, never while a run of it waits or runs, and one that holds anything only once the
 * caller confirmed what goes with it, like the dialog that lists it first.
 */
export async function deleteTenantAs(actor: TenantAdminActor, tenantId: string, confirmed: boolean) {
    const refused = await deleteRefusal(actor, tenantId);
    if (refused === TENANT_GONE) throw new TenantGoneError(tenantId);
    if (refused) throw new TenantAdminRefusal(refused);
    const contents = await tenantContents(tenantId);
    if (!confirmed && !isEmptyTenant(contents)) throw new TenantNotEmptyError(contents);
    return removeTenantAs(actor, tenantId);
}
