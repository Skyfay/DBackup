import prisma from "@/lib/prisma";
import { connectionAddress } from "@/lib/adapters/connection-summary";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { versionOf } from "./database-explorer-model";
import type { ServerDetails, ServersOverview, VersionPage, VersionPeriod } from "./database-explorer-types";
import { behindOf, inPeriod, versionPeriods, type KeptBackup } from "./server-explorer-model";

const log = logger.child({ service: "ServerExplorerService" });

const DAY_MS = 86_400_000;
const KEPT_STATUSES = ["Success", "Partial"];

/**
 * The Servers tab of the Database Explorer: every database server with where it runs, how fast it
 * answers, its kept backups and whether it is too old for the newest backups of its engine, and
 * the versions each ran with the backups made on them. Nothing here asks a server.
 */
export class ServerExplorerService {
    /** Every database server. The kept backups and Behind only for a viewer who may see backups. */
    async getServers({ withBackups }: { withBackups: boolean }): Promise<ServersOverview> {
        const [sources, newVersions] = await Promise.all([
            prisma.adapterConfig.findMany({
                where: { type: "database" },
                select: { id: true, name: true, adapterId: true, config: true, metadata: true },
                orderBy: { name: "asc" },
            }),
            prisma.dbVersionHistory.count({
                where: { previousVersion: { not: null }, detectedAt: { gte: new Date(Date.now() - 30 * DAY_MS) }, adapterConfig: { type: "database" } },
            }),
        ]);
        const [latencies, kept] = await Promise.all([
            Promise.all(sources.map((source) => this.latency(source.id))),
            withBackups ? this.keptBackups() : Promise.resolve<KeptBackup[]>([]),
        ]);
        const servers = sources.map((source) => ({ id: source.id, name: source.name, adapterId: source.adapterId, version: versionOf(source.metadata) }));

        return {
            servers: sources.map((source, index) => {
                const mine = kept.filter((backup) => backup.serverId === source.id);
                const newest = mine.reduce<KeptBackup | null>((best, backup) => (!best || backup.createdAt > best.createdAt ? backup : best), null);
                return {
                    id: source.id,
                    address: connectionAddress(source.adapterId, source.config) ?? null,
                    latencyMs: latencies[index],
                    keptBackups: withBackups ? mine.length : null,
                    lastBackupAt: newest?.createdAt ?? null,
                    behind: withBackups ? behindOf(servers[index], servers, kept) : null,
                };
            }),
            newVersions,
            backups: withBackups,
        };
    }

    /** One server for its page, with how often it answered in the last 30 days. Null for an unknown id. */
    async getServer(id: string, { withBackups }: { withBackups: boolean }): Promise<ServerDetails | null> {
        const { servers } = await this.getServers({ withBackups });
        const summary = servers.find((server) => server.id === id);
        if (!summary) return null;
        return { ...summary, uptime: await this.uptime(id) };
    }

    /**
     * One page of the versions a server ran, newest first, with the backups made while each ran and
     * how many of them are still kept. Only the versions of the page are counted. Null for an unknown id.
     */
    async getVersions(id: string, page: number, size: number, { withJobs, withBackups }: { withJobs: boolean; withBackups: boolean }): Promise<VersionPage | null> {
        const source = await prisma.adapterConfig.findFirst({ where: { id, type: "database" }, select: { id: true, metadata: true } });
        if (!source) return null;
        const rows = await prisma.dbVersionHistory.findMany({
            where: { adapterConfigId: id },
            select: { previousVersion: true, newVersion: true, detectedAt: true },
        });
        const all = versionPeriods(rows, versionOf(source.metadata));
        const shown = all.slice((page - 1) * size, page * size);

        const [jobIds, kept] = await Promise.all([
            prisma.job.findMany({ where: { sourceId: id }, select: { id: true } }).then((jobs) => jobs.map((job) => job.id)),
            withBackups ? this.keptBackups().then((backups) => backups.filter((backup) => backup.serverId === id)) : Promise.resolve(null),
        ]);
        const made = withJobs ? await Promise.all(shown.map((period) => this.madeIn(jobIds, period))) : null;

        return {
            versions: shown.map((period, index) => ({
                ...period,
                kept: kept ? kept.filter((backup) => inPeriod(period, Date.parse(backup.createdAt))).length : null,
                made: made ? made[index] : null,
            })),
            total: all.length,
            page,
            size,
        };
    }

    /** Every kept backup of a job with a database source, by the server of its job. */
    private async keptBackups(): Promise<KeptBackup[]> {
        const [{ runs }, jobs] = await Promise.all([
            storageExplorerService.getBackups(),
            prisma.job.findMany({ where: { sourceId: { not: null } }, select: { id: true, sourceId: true } }),
        ]);
        const serverOf = new Map(jobs.map((job) => [job.id, job.sourceId as string]));
        return runs.flatMap((run) => {
            // The backups of a deleted job have no server left to belong to.
            const serverId = serverOf.get(run.jobKey) ?? (run.file.jobId ? serverOf.get(run.file.jobId) : undefined);
            return serverId ? [{ serverId, createdAt: run.createdAt, engineVersion: run.file.engineVersion ?? null }] : [];
        });
    }

    /** The backups the jobs of a server made while it ran one version. */
    private async madeIn(jobIds: string[], period: Omit<VersionPeriod, "kept" | "made">): Promise<number> {
        if (jobIds.length === 0) return 0;
        const startedAt = {
            ...(period.since ? { gte: new Date(period.since) } : {}),
            ...(period.until ? { lt: new Date(period.until) } : {}),
        };
        return prisma.execution.count({ where: { jobId: { in: jobIds }, type: "Backup", status: { in: KEPT_STATUSES }, startedAt } });
    }

    /** How long the latest health check of a server took. One lookup on the index of the check log. */
    private async latency(id: string): Promise<number | null> {
        try {
            const last = await prisma.healthCheckLog.findFirst({ where: { adapterConfigId: id }, orderBy: { createdAt: "desc" }, select: { latencyMs: true } });
            return last?.latencyMs ?? null;
        } catch (error: unknown) {
            log.warn("Could not read the latest check", { serverId: id }, wrapError(error));
            return null;
        }
    }

    /** The share of the checks of the last 30 days that passed, in percent with one decimal. */
    private async uptime(id: string): Promise<number | null> {
        const from = new Date(Date.now() - 30 * DAY_MS);
        const [total, passed] = await Promise.all([
            prisma.healthCheckLog.count({ where: { adapterConfigId: id, createdAt: { gte: from } } }),
            prisma.healthCheckLog.count({ where: { adapterConfigId: id, createdAt: { gte: from }, status: "ONLINE" } }),
        ]);
        return total === 0 ? null : Math.round((passed / total) * 1000) / 10;
    }
}

export const serverExplorerService = new ServerExplorerService();
