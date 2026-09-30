/**
 * The records the global search finds by name: jobs, connections, the databases on the servers and
 * the latest runs of a job. It searches only the kinds the caller allows, so the route decides what
 * the viewer may see. Pages, actions and settings the search finds in the browser.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { MIN_QUERY_LENGTH, type SearchHit, type SearchScope } from "./search-types";

const log = logger.child({ service: "SearchService" });

/** Hits per kind, the first ones in the order of their names. */
const PER_KIND = 5;
const FINISHED = ["Success", "Failed", "Partial"];

async function jobs(query: string): Promise<SearchHit[]> {
    const found = await prisma.job.findMany({
        where: { name: { contains: query } },
        orderBy: { name: "asc" },
        take: PER_KIND,
        select: { id: true, name: true, enabled: true, schedule: true, schedulePreset: { select: { schedule: true } }, source: { select: { adapterId: true } } },
    });
    // The newest finished run of each, which the index on job and start time finds at once.
    const last = await Promise.all(found.map((job) => prisma.execution.findFirst({
        where: { jobId: job.id, status: { in: FINISHED } },
        orderBy: { startedAt: "desc" },
        select: { status: true },
    })));
    return found.map((job, index) => ({
        kind: "job",
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        schedule: job.schedulePreset?.schedule ?? job.schedule,
        adapterId: job.source?.adapterId ?? null,
        lastStatus: last[index]?.status ?? null,
    }));
}

async function connections(query: string, types: SearchScope["connections"]): Promise<SearchHit[]> {
    if (types.length === 0) return [];
    const found = await prisma.adapterConfig.findMany({
        where: { name: { contains: query }, type: { in: [...types] } },
        orderBy: { name: "asc" },
        take: PER_KIND + 1,
        select: { id: true, name: true, adapterId: true, type: true, storageRole: true, lastStatus: true },
    });
    return found.map((config) => ({
        kind: "connection",
        id: config.id,
        name: config.name,
        adapterId: config.adapterId,
        type: config.type,
        storageRole: config.storageRole,
        status: config.lastStatus,
    }));
}

async function databases(query: string): Promise<SearchHit[]> {
    const lists = await prisma.databaseListCache.findMany({
        select: { adapterConfigId: true, databasesJson: true, adapterConfig: { select: { name: true, adapterId: true } } },
    });
    const needle = query.toLowerCase();
    const hits: Extract<SearchHit, { kind: "database" }>[] = [];
    for (const list of lists) {
        let entries: { name?: unknown; sizeInBytes?: unknown }[] = [];
        try {
            entries = JSON.parse(list.databasesJson);
        } catch (error: unknown) {
            log.warn("A cached database list could not be read for the search", { adapterConfigId: list.adapterConfigId }, wrapError(error));
            continue;
        }
        for (const entry of Array.isArray(entries) ? entries : []) {
            if (typeof entry.name !== "string" || !entry.name.toLowerCase().includes(needle)) continue;
            hits.push({
                kind: "database",
                serverId: list.adapterConfigId,
                serverName: list.adapterConfig.name,
                adapterId: list.adapterConfig.adapterId,
                name: entry.name,
                sizeInBytes: typeof entry.sizeInBytes === "number" ? entry.sizeInBytes : null,
            });
        }
    }
    return hits.sort((a, b) => a.name.localeCompare(b.name)).slice(0, PER_KIND);
}

async function runs(query: string): Promise<SearchHit[]> {
    const found = await prisma.execution.findMany({
        where: { job: { name: { contains: query } } },
        orderBy: { startedAt: "desc" },
        take: 3,
        select: { id: true, status: true, startedAt: true, job: { select: { name: true, source: { select: { adapterId: true } } } } },
    });
    return found.map((run) => ({
        kind: "run",
        id: run.id,
        name: run.job?.name ?? "Run",
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        adapterId: run.job?.source?.adapterId ?? null,
    }));
}

/** Everything of the allowed kinds whose name holds the query, regardless of case. */
export async function searchRecords(query: string, scope: SearchScope): Promise<SearchHit[]> {
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH) return [];
    const parts = await Promise.all([
        scope.jobs ? jobs(term) : [],
        connections(term, scope.connections),
        scope.databases ? databases(term) : [],
        scope.runs ? runs(term) : [],
    ]);
    return parts.flat();
}
