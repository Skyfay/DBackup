import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { OUTSIDE_REACH, reachCovers, type PlatformReach } from "@/lib/tenant/sharing-reach";
import { TENANTS_FOLDER, isTenantsFolderName } from "@/lib/tenant/storage-view";
import { sharesWithCustomers } from "@/services/tenant/shared-servers";
import { assertSharedPlaceAlone } from "@/services/adapters/shared-place";
import { refreshStorageStatsCache, storageEntriesOf } from "@/services/dashboard-service";
import { isEmailChannel, sharedKindOf, type SharedKind } from "./provided";
import { logger } from "@/lib/logging/logger";
import { PartialLossError, customerFolderFiles, deleteTenantBackups, forgetConnection, sweepCustomerFolder, type TenantLoss } from "./share-cleanup";
import { boundToReach, shareReachView, type ShareReachView } from "./share-reach";

const log = logger.child({ service: "ConnectionShares" });

/** What a change of a share did: who got the connection, and what each tenant that lost it lost. */
export interface ShareChange {
    name: string;
    kind: SharedKind;
    gained: string[];
    /**
     * What each tenant that lost it lost. `noted` says whether its log and its Connections page hear
     * of it, which after a share with every tenant only a tenant that used it does.
     */
    losses: (TenantLoss & { name: string; noted: boolean })[];
}

/**
 * Taking a connection away failed at one tenant. The change holds what the tenants before it
 * lost, which are off the share now, so the caller logs it before it shows the failure.
 */
export class ShareChangeError extends ValidationError {
    constructor(message: string, readonly change: ShareChange) {
        super(message);
        this.name = "ShareChangeError";
    }
}

/**
 * The tenant of a destination or a channel shares it with other tenants: every other tenant, new
 * ones too, or the ones it picks. It runs in the scope of that tenant, so it finds only its own
 * connections. A tenant that loses a connection loses every link to it, and on a destination its
 * backups there, see `share-cleanup.ts`. What the tenant that shares sees of its customers is how
 * much they use it, never their backups. A change takes the `PlatformReach` of the person, so
 * someone of a platform group of some tenants shares with and takes from those only, see
 * `share-reach.ts`.
 */

/**
 * Why a save that takes a connection from tenants waits for `confirmed`, with what they lose: the
 * links of a channel in their jobs, templates and notifications, and on a destination its backups.
 */
export const UNCONFIRMED_LOSS: Record<SharedKind, string> = {
    destination: "The tenants that lose this destination lose their backups on it, and their jobs lose it. Confirm it first.",
    channel: "The tenants that lose this channel lose it in their notification templates, their jobs, their notification settings and their recipients. Confirm it first.",
};

export const NOT_SHARING_CONNECTIONS = "This tenant shares nothing with customers. The platform switches it on for a tenant of the MSP.";

/** Who gets a connection and on what terms. */
export interface ShareSettings {
    allTenants: boolean;
    /** The tenants that get it while it is not shared with every tenant. */
    tenantIds: string[];
    /** A destination: a job of a customer writes to it only with a key of its Vault. */
    encryptedOnly: boolean;
    /** An email channel: each customer names its own recipients. */
    ownRecipients: boolean;
}

/** How one tenant uses a connection shared with it. */
export interface ShareTenantUse {
    tenantId: string;
    name: string;
    /** Its jobs that write to the destination, or that tell the channel through a template or by name. */
    jobs: number;
    /** A channel: its notification templates that name it. */
    templates: number;
    /** A destination: its backups there and their size at the last measurement, null before the destination was measured once. */
    backups: number | null;
    size: number | null;
    /** A destination that asks for encrypted backups: its jobs without a key, which write nothing to it. */
    jobsWithoutKey: number;
    /** A destination: when its last backup there ended. */
    lastBackup: Date | null;
}

export interface ConnectionShareView {
    configId: string;
    name: string;
    kind: SharedKind;
    /** An email channel, which may let each customer name its recipients. */
    email: boolean;
    /** Whether anybody gets it now. */
    shared: boolean;
    /**
     * A destination nobody gets any more whose folder of the customers could not be emptied yet. It
     * stays shared with nobody until a save with nobody picked empties it.
     */
    cleanupPending: boolean;
    settings: ShareSettings;
    /** The other tenants the viewer may share it with: every one, or those their platform group reaches. */
    candidates: { id: string; name: string }[];
    /** What the platform group of the viewer leaves out of a change. */
    reach: ShareReachView;
    /** A destination: what its own tenant keeps there. */
    own: { backups: number | null; size: number | null } | null;
    /** Each tenant that gets it now. */
    uses: ShareTenantUse[];
}

/** The summary of a share for the lists: every tenant, or the names of those that get it. */
export interface ShareSummary {
    allTenants: boolean;
    tenants: { id: string; name: string }[];
    encryptedOnly: boolean;
    ownRecipients: boolean;
}

async function ownConnection(configId: string) {
    const config = await prisma.adapterConfig.findFirst({ where: { id: configId }, select: { id: true, name: true, type: true, adapterId: true, storageRole: true, tenantId: true } });
    if (!config) throw new NotFoundError("Connection", configId);
    const kind = sharedKindOf(config);
    if (!kind) throw new ValidationError("Only a destination or a notification channel is shared with other tenants.");
    return { ...config, kind };
}

/** The tenants a share gives the connection to now. */
function customersOf(share: { allTenants: boolean; tenants: { tenantId: string }[] } | null, others: { id: string }[]): string[] {
    if (!share) return [];
    const known = new Set(others.map((tenant) => tenant.id));
    return share.allTenants ? others.map((tenant) => tenant.id) : share.tenants.map((entry) => entry.tenantId).filter((id) => known.has(id));
}

async function otherTenants(providerId: string) {
    return prisma.tenant.findMany({ where: { id: { not: providerId } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

async function usesOf(config: { id: string; tenantId: string }, kind: SharedKind, customers: { id: string; name: string }[], encryptedOnly: boolean): Promise<ShareTenantUse[]> {
    if (customers.length === 0) return [];
    const ids = customers.map((tenant) => tenant.id);
    return runAsSystem(async () => {
        if (kind === "channel") {
            const [templates, direct] = await Promise.all([
                prisma.notificationTemplateChannel.findMany({ where: { configId: config.id, template: { tenantId: { in: ids } } }, select: { template: { select: { tenantId: true, jobs: { select: { jobId: true } } } } } }),
                prisma.job.findMany({ where: { tenantId: { in: ids }, notifications: { some: { id: config.id } } }, select: { id: true, tenantId: true } }),
            ]);
            return customers.map((tenant) => {
                const own = templates.filter((entry) => entry.template.tenantId === tenant.id);
                const jobs = new Set([...own.flatMap((entry) => entry.template.jobs.map((job) => job.jobId)), ...direct.filter((job) => job.tenantId === tenant.id).map((job) => job.id)]);
                return { tenantId: tenant.id, name: tenant.name, jobs: jobs.size, templates: own.length, backups: null, size: null, jobsWithoutKey: 0, lastBackup: null };
            });
        }
        const [jobs, entries] = await Promise.all([
            prisma.job.findMany({ where: { tenantId: { in: ids }, destinations: { some: { configId: config.id } } }, select: { id: true, tenantId: true, encryptionProfileId: true } }),
            storageEntriesOf(config.id),
        ]);
        // Once the destination was measured, a customer without an entry has written nothing there yet.
        const measured = entries.length > 0;
        return Promise.all(customers.map(async (tenant) => {
            const theirs = jobs.filter((job) => job.tenantId === tenant.id);
            const entry = entries.find((candidate) => candidate.tenantId === tenant.id) ?? (measured ? { count: 0, size: 0 } : undefined);
            const last = theirs.length === 0 ? null : await prisma.execution.findFirst({
                where: { tenantId: tenant.id, type: "Backup", status: { in: ["Success", "Partial"] }, jobId: { in: theirs.map((job) => job.id) } },
                orderBy: { startedAt: "desc" },
                select: { startedAt: true, endedAt: true },
            });
            return {
                tenantId: tenant.id,
                name: tenant.name,
                jobs: theirs.length,
                templates: 0,
                backups: entry ? entry.count : null,
                size: entry ? entry.size : null,
                // A job without a key writes to a destination that takes any backup.
                jobsWithoutKey: encryptedOnly ? theirs.filter((job) => !job.encryptionProfileId).length : 0,
                lastBackup: last ? (last.endedAt ?? last.startedAt) : null,
            };
        }));
    });
}

/** The tenant of a run of `tenantIds` that writes to a destination now or waits to, null without one. */
async function runningRunOf(configId: string, tenantIds: readonly string[]): Promise<string | null> {
    const running = await runAsSystem(() => prisma.execution.findFirst({
        where: { status: { in: ["Pending", "Running"] }, tenantId: { in: [...tenantIds] }, job: { destinations: { some: { configId } } } },
        select: { tenantId: true },
    }));
    return running?.tenantId ?? null;
}

export const connectionShareService = {
    /** The shares of the own connections among `configIds`, for the lists. */
    async summaries(configIds: string[]): Promise<Map<string, ShareSummary>> {
        if (configIds.length === 0) return new Map();
        const shares = await prisma.connectionShare.findMany({ where: { id: { in: configIds } }, include: { tenants: { select: { tenantId: true } } } });
        if (shares.length === 0) return new Map();
        const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
        return new Map(shares.map((share) => {
            const others = tenants.filter((tenant) => tenant.id !== share.tenantId);
            const ids = new Set(customersOf(share, others));
            return [share.id, {
                allTenants: share.allTenants,
                tenants: others.filter((tenant) => ids.has(tenant.id)),
                encryptedOnly: share.encryptedOnly,
                ownRecipients: share.ownRecipients,
            }];
        }));
    },

    /** Who gets a connection of the tenant that runs now, and how each uses it. */
    async view(configId: string, reach: PlatformReach = "all"): Promise<ConnectionShareView> {
        const config = await ownConnection(configId);
        const [share, others] = await Promise.all([
            prisma.connectionShare.findUnique({ where: { id: configId }, include: { tenants: { select: { tenantId: true } } } }),
            otherTenants(config.tenantId),
        ]);
        const ids = new Set(customersOf(share, others));
        const customers = others.filter((tenant) => ids.has(tenant.id));
        const ownEntry = config.kind === "destination" ? (await storageEntriesOf(configId)).find((entry) => entry.tenantId === config.tenantId || !entry.tenantId) : undefined;
        return {
            configId,
            name: config.name,
            kind: config.kind,
            email: isEmailChannel(config.adapterId),
            shared: customers.length > 0 || Boolean(share?.allTenants),
            cleanupPending: config.kind === "destination" && Boolean(share) && !share?.allTenants && customers.length === 0,
            settings: {
                allTenants: share?.allTenants ?? false,
                tenantIds: share?.allTenants ? [] : customers.map((tenant) => tenant.id),
                encryptedOnly: share?.encryptedOnly ?? false,
                ownRecipients: share?.ownRecipients ?? true,
            },
            candidates: others.filter((tenant) => reachCovers(reach, tenant.id)),
            reach: shareReachView({ name: config.name, share, customers, reach }),
            own: config.kind === "destination" ? { backups: ownEntry ? ownEntry.count : null, size: ownEntry ? ownEntry.size : null } : null,
            uses: await usesOf(config, config.kind, customers, share?.encryptedOnly ?? false),
        };
    },

    /** The tenants that would lose the connection with these settings, with what each uses of it. */
    async losing(configId: string, settings: Pick<ShareSettings, "allTenants" | "tenantIds">, reach: PlatformReach = "all"): Promise<ShareTenantUse[]> {
        const config = await ownConnection(configId);
        const [share, others] = await Promise.all([
            prisma.connectionShare.findUnique({ where: { id: configId }, include: { tenants: { select: { tenantId: true } } } }),
            otherTenants(config.tenantId),
        ]);
        const before = customersOf(share, others);
        const names = new Map(others.map((tenant) => [tenant.id, tenant.name]));
        const bound = boundToReach({ name: config.name, share, before, wanted: settings, termsChanged: false, reach, nameOf: (id) => names.get(id) ?? "a tenant" });
        const after = new Set(bound.allTenants ? others.map((tenant) => tenant.id) : bound.tenantIds);
        const lost = before.filter((id) => !after.has(id));
        return usesOf(config, config.kind, others.filter((tenant) => lost.includes(tenant.id)), share?.encryptedOnly ?? false);
    },

    /**
     * Saves who gets a connection. A tenant that loses it loses every link to it first, and on a
     * destination its backups there, which `confirmed` must allow for either kind. When the storage does not answer,
     * the share stays as it was. Without anybody left the connection is no longer shared. With a
     * reach of some tenants it changes only those, see `boundToReach`.
     */
    async save(configId: string, settings: ShareSettings, options: { confirmed?: boolean; reach?: PlatformReach } = {}): Promise<ShareChange> {
        const config = await ownConnection(configId);
        if (!(await sharesWithCustomers(config.tenantId))) throw new ValidationError(NOT_SHARING_CONNECTIONS);
        const others = await otherTenants(config.tenantId);
        const known = new Map(others.map((tenant) => [tenant.id, tenant.name]));
        const picked = [...new Set(settings.tenantIds)];
        if (!settings.allTenants && picked.some((id) => !known.has(id))) throw new ValidationError("A tenant you picked is this one or no longer exists.");

        const share = await prisma.connectionShare.findUnique({ where: { id: configId }, include: { tenants: { select: { tenantId: true } } } });
        const before = customersOf(share, others);
        const terms = {
            encryptedOnly: config.kind === "destination" && settings.encryptedOnly,
            // A chat or a webhook has its address for a recipient, so it always sends where it is set.
            ownRecipients: config.kind === "channel" && isEmailChannel(config.adapterId) && settings.ownRecipients,
        };
        const termsChanged = Boolean(share) && (config.kind === "destination"
            ? terms.encryptedOnly !== share?.encryptedOnly
            : isEmailChannel(config.adapterId) && terms.ownRecipients !== share?.ownRecipients);
        const bound = boundToReach({ name: config.name, share, before, wanted: { allTenants: settings.allTenants, tenantIds: picked }, termsChanged, reach: options.reach ?? "all", nameOf: (id) => known.get(id) ?? "a tenant" });
        const after = bound.allTenants ? others.map((tenant) => tenant.id) : bound.tenantIds;
        const lost = before.filter((id) => !after.includes(id));
        const gained = after.filter((id) => !before.includes(id));

        if (config.kind === "destination" && (bound.allTenants || after.length > 0)) {
            const jobs = await prisma.job.findMany({ where: { destinations: { some: { configId } } }, select: { name: true } });
            if (jobs.some((job) => isTenantsFolderName(job.name))) throw new ValidationError(`A job of this tenant is called ${TENANTS_FOLDER} and writes into the folder a shared destination keeps for its customers. Rename it first.`);
            // Whatever lies there before the first share would read as the backups of a customer.
            if (!share && (await customerFolderFiles(configId)) > 0) {
                throw new ValidationError(`${config.name} already holds files in ${TENANTS_FOLDER}/, the folder a shared destination keeps for its customers. Move or delete them first.`);
            }
            // A second connection to the same folder would show the customers' backups in the view of this tenant.
            if (!share) await assertSharedPlaceAlone(configId);
        }
        if (lost.length > 0 && !options.confirmed) throw new ValidationError(UNCONFIRMED_LOSS[config.kind]);

        // A share with nobody on it goes, unless `keep` holds it for a folder of the customers that
        // could not be emptied yet.
        const writeShare = (customers: string[], allTenants: boolean, keep = false, shareTerms = terms) => prisma.$transaction(async (tx) => {
            if (!allTenants && customers.length === 0 && !keep) {
                await tx.connectionShare.deleteMany({ where: { id: configId } });
                return;
            }
            await tx.connectionShare.upsert({ where: { id: configId }, create: { id: configId, tenantId: config.tenantId, ...shareTerms, allTenants }, update: { ...shareTerms, allTenants } });
            await tx.connectionShareTenant.deleteMany({ where: { shareId: configId } });
            if (!allTenants) await tx.connectionShareTenant.createMany({ data: customers.map((tenantId) => ({ shareId: configId, tenantId })) });
        });
        // Puts the tenants that kept everything back on the share: the share as it was when nobody
        // lost anything yet, else every tenant but those that lost everything already.
        const putBack = async (gone: ReadonlySet<string>) => {
            if (!share) return;
            if (gone.size === 0) await writeShare(before, share.allTenants, true, { encryptedOnly: share.encryptedOnly, ownRecipients: share.ownRecipients });
            else await writeShare(before.filter((id) => !gone.has(id)), false, true);
        };
        // After an All tenants share only the tenants that used it hear of it, not every tenant there is.
        const named = (losses: TenantLoss[]) => losses.map((loss) => ({ ...loss, name: known.get(loss.tenantId) ?? loss.tenantId, noted: !share?.allTenants || loss.used }));

        // The tenants that lose it come off the share first, so no run of theirs starts writing to it
        // or sending through it while it is taken away. The share stays even with nobody on it until
        // the folder of the customers is empty, so its tenant never sees a backup of a customer.
        if (lost.length > 0 && share) await writeShare(before.filter((id) => !lost.includes(id)), false, true, { encryptedOnly: share.encryptedOnly, ownRecipients: share.ownRecipients });
        // A run that writes there now, or one that waited before and may start any moment, would put a
        // backup into the folder after it was emptied.
        if (config.kind === "destination" && lost.length > 0) {
            const running = await runningRunOf(configId, lost);
            if (running) {
                await putBack(new Set());
                throw new ValidationError(`A run of ${known.get(running) ?? "a tenant"} writes to this destination right now or waits to. Try again once it finished.`);
            }
        }

        // Taken away one tenant after the other. When the storage stops answering, the tenants that
        // lost everything already stay off the share and every other one gets it back as it was.
        let losses: TenantLoss[];
        try {
            losses = await forgetConnection(configId, config.kind, lost);
        } catch (error) {
            if (!(error instanceof PartialLossError)) throw error;
            await putBack(new Set(error.losses.map((loss) => loss.tenantId)));
            throw new ShareChangeError(error.message, { name: config.name, kind: config.kind, gained: [], losses: named(error.losses) });
        }

        const shared = bound.allTenants || after.length > 0;
        // Nobody gets the destination any more, so its tenant would see all of it again. Whatever a
        // customer left there goes first. When the storage does not answer, the share stays with
        // nobody on it, so its tenant still sees the destination without the folder of the
        // customers, and the next save empties it again.
        if (config.kind === "destination" && !shared && share) {
            try {
                await sweepCustomerFolder(configId);
            } catch (error: unknown) {
                log.warn("The folder of the customers could not be emptied", { configId }, wrapError(error));
                await writeShare([], false, true);
                throw new ShareChangeError(
                    `Nobody gets ${config.name} any more, but what its customers left in ${TENANTS_FOLDER}/ could not be deleted: ${getErrorMessage(error)}. Save again once the storage answers, until then it stays shared with nobody.`,
                    { name: config.name, kind: config.kind, gained: [], losses: named(losses) },
                );
            }
        }
        await writeShare(after, bound.allTenants);
        if (config.kind === "destination" && lost.length > 0) await refreshStorageStatsCache({ configIds: [configId] }).catch(() => undefined);
        return { name: config.name, kind: config.kind, gained: gained.map((id) => known.get(id) ?? id), losses: named(losses) };
    },

    /** Stops sharing a connection with one tenant, with every other tenant keeping it. */
    async stopFor(configId: string, tenantId: string, options: { confirmed?: boolean; reach?: PlatformReach } = {}) {
        const reach = options.reach ?? "all";
        if (!reachCovers(reach, tenantId)) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
            throw new ValidationError(OUTSIDE_REACH.share(tenant?.name ?? "this tenant"));
        }
        const view = await this.view(configId, reach);
        const tenantIds = (view.settings.allTenants ? view.candidates.map((tenant) => tenant.id) : view.settings.tenantIds).filter((id) => id !== tenantId);
        return this.save(configId, { ...view.settings, allTenants: false, tenantIds }, options);
    },

    /** Deletes the backups of one tenant on a destination of the tenant that runs now. Its jobs go on writing. */
    async deleteBackupsOf(configId: string, tenantId: string, reach: PlatformReach = "all"): Promise<{ name: string; tenantName: string; backups: number }> {
        const config = await ownConnection(configId);
        if (config.kind !== "destination") throw new ValidationError("Only a destination holds backups.");
        if (tenantId === config.tenantId) throw new ValidationError("These are the backups of this tenant. Delete them on the Backups page.");
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        if (!tenant) throw new NotFoundError("Tenant", tenantId);
        if (!reachCovers(reach, tenantId)) throw new ValidationError(OUTSIDE_REACH.backups(tenant.name));
        // Only of a tenant that gets the destination now. One that lost it lost its backups with it.
        const [share, others] = await Promise.all([
            prisma.connectionShare.findUnique({ where: { id: configId }, include: { tenants: { select: { tenantId: true } } } }),
            otherTenants(config.tenantId),
        ]);
        if (!customersOf(share, others).includes(tenantId)) throw new ValidationError(`${tenant.name} does not get this destination.`);
        // A run that writes there now would lose its backup under it, or leave half of it behind.
        if (await runningRunOf(configId, [tenantId])) throw new ValidationError(`A run of ${tenant.name} writes to this destination right now or waits to. Try again once it finished.`);
        const backups = await deleteTenantBackups(configId, tenantId);
        await refreshStorageStatsCache({ configIds: [configId] }).catch(() => undefined);
        return { name: config.name, tenantName: tenant.name, backups };
    },
};
