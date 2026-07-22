/**
 * Decides whether a run produces a full backup or an incremental one.
 *
 * Incremental backups trade durability for storage: if a chain's full is lost, every
 * snapshot built on it loses most of its data. The rules here are therefore deliberately
 * conservative - anything that makes the previous snapshot an unreliable basis degrades
 * the run to a full, and the reason is logged so it is never a silent decision.
 *
 * Database dumps are always stored in full. An incremental archive is "every database
 * complete, plus only the directory files that changed".
 */

import path from "path";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { BackupMetadata, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { registry } from "@/lib/core/registry";
import { archiveIndexService } from "./archive-index-service";
import { ArchiveIndex } from "@/lib/archive/types";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "ChainPlanner" });

export interface ChainPlan {
    type: "full" | "incremental";
    chainId: string;
    /** Position in the chain. A full is 0. */
    index: number;
    /** Filename of the predecessor archive. Only set for an incremental. */
    baseArchive?: string;
    /** Parsed index of the predecessor snapshot. Only set for an incremental. */
    previousIndex?: ArchiveIndex;
    /** Directory the chain's archives live in, relative to the destination root. */
    chainDir: string;
    /** Human-readable reason a full was chosen, for the execution log. */
    reason?: string;
}

/** Directory name for a new chain, derived from the moment it starts. */
export function chainDirName(startedAt: Date): string {
    return `chain-${startedAt.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "")}`;
}

interface PreviousSnapshot {
    executionId: string;
    chainId: string;
    chainIndex: number;
    /** Remote path of the archive, e.g. "job/chain-.../inc-2.tar". */
    remotePath: string;
    chainStartedAt: Date;
    /** Remote path of the chain's full backup, which every snapshot depends on. */
    fullPath: string | null;
}

/** Newest successful snapshot of the job's current chain, if there is one. */
async function findPreviousSnapshot(jobId: string): Promise<PreviousSnapshot | null> {
    const previous = await prisma.execution.findFirst({
        where: {
            jobId,
            type: "Backup",
            status: { in: ["Success", "Partial"] },
            chainId: { not: null },
            path: { not: null },
        },
        orderBy: { startedAt: "desc" },
    });
    if (!previous?.chainId || !previous.path) return null;

    const chainStart = await prisma.execution.findFirst({
        where: { jobId, chainId: previous.chainId, chainIndex: 0 },
        orderBy: { startedAt: "asc" },
    });

    return {
        executionId: previous.id,
        chainId: previous.chainId,
        chainIndex: previous.chainIndex ?? 0,
        remotePath: previous.path,
        chainStartedAt: chainStart?.startedAt ?? previous.startedAt,
        fullPath: chainStart?.path ?? null,
    };
}

/** Reads a backup's `.meta.json` from a destination. */
async function readMeta(configId: string, remotePath: string): Promise<BackupMetadata | null> {
    const row = await prisma.adapterConfig.findUnique({ where: { id: configId } });
    if (!row || row.type !== "storage") return null;

    const adapter = registry.get(row.adapterId) as StorageAdapter | undefined;
    if (!adapter?.read) return null;

    try {
        const content = await adapter.read(await resolveAdapterConfig(row), `${remotePath}.meta.json`);
        return content ? (JSON.parse(content) as BackupMetadata) : null;
    } catch {
        return null;
    }
}

/** True when every archive of the chain is present at the destination. */
async function chainIntactAt(configId: string, chainDir: string, expectedCount: number): Promise<boolean> {
    const row = await prisma.adapterConfig.findUnique({ where: { id: configId } });
    if (!row || row.type !== "storage") return false;

    const adapter = registry.get(row.adapterId) as StorageAdapter | undefined;
    if (!adapter) return false;

    try {
        const files = await adapter.list(await resolveAdapterConfig(row), chainDir);
        const archives = files.filter((f) => f.name.endsWith(".tar"));
        return archives.length >= expectedCount;
    } catch {
        return false;
    }
}

export interface ChainPlanInput {
    job: {
        id: string;
        name: string;
        backupMode: string;
        fullEveryDays: number;
        encryptionProfileId: string | null;
    };
    /** Directory sources configured for this run, with their effective exclude patterns. */
    sources: { jobSourceId: string; excludePatterns: string[] }[];
    /** Every destination this run uploads to. */
    destinationConfigIds: string[];
    now: Date;
}

/**
 * Plans the run.
 *
 * The chain is tracked per job rather than per destination. If any destination is missing
 * a chain member - because one of its uploads failed earlier - the whole run degrades to a
 * full. Per-destination chains would mean building different archives for different
 * destinations in the same run, which is not worth the complexity; occasional extra fulls
 * are the conservative trade.
 */
export async function planChain(input: ChainPlanInput): Promise<ChainPlan> {
    const fresh = (reason?: string): ChainPlan => ({
        type: "full",
        chainId: crypto.randomUUID(),
        index: 0,
        chainDir: chainDirName(input.now),
        ...(reason ? { reason } : {}),
    });

    if (input.job.backupMode !== "INCREMENTAL") {
        return { ...fresh(), chainDir: chainDirName(input.now) };
    }

    const previous = await findPreviousSnapshot(input.job.id);
    if (!previous) return fresh("no previous backup to build on");

    const ageDays = (input.now.getTime() - previous.chainStartedAt.getTime()) / 86_400_000;
    if (ageDays >= input.job.fullEveryDays) {
        return fresh(`the chain reached its maximum age of ${input.job.fullEveryDays} day(s)`);
    }

    const chainDir = path.posix.basename(path.posix.dirname(previous.remotePath.replace(/\\/g, "/")));

    // The metadata is read from the first destination that can serve it - all destinations
    // receive identical archives, so any of them describes the run.
    let meta: BackupMetadata | null = null;
    let metaConfigId: string | undefined;
    for (const configId of input.destinationConfigIds) {
        meta = await readMeta(configId, previous.remotePath);
        if (meta) { metaConfigId = configId; break; }
    }
    if (!meta || !metaConfigId) return fresh("the previous backup's metadata could not be read");

    if (meta.archive?.formatVersion !== 2) {
        return fresh("the previous backup predates the seekable archive format");
    }

    // A profile change would leave a snapshot referencing bytes encrypted under a different
    // key, so a restore would need two profile keys. Starting fresh keeps that impossible.
    const previousProfile = meta.archive.encrypted ? meta.archive.profileId ?? null : null;
    if (previousProfile !== (input.job.encryptionProfileId ?? null)) {
        return fresh("the encryption profile changed");
    }

    // Everything in the chain hangs off its full. If the full is known to be damaged,
    // continuing would pile more snapshots onto data that cannot be restored.
    if (previous.fullPath && previous.fullPath !== previous.remotePath) {
        const fullMeta = await readMeta(metaConfigId, previous.fullPath);
        if (fullMeta?.verification && fullMeta.verification.passed === false) {
            return fresh("the chain's full backup failed its last integrity check");
        }
    }
    if (meta.verification && meta.verification.passed === false) {
        return fresh("the previous backup failed its last integrity check");
    }

    let previousIndex: ArchiveIndex | null;
    try {
        previousIndex = await archiveIndexService.load(metaConfigId, previous.remotePath, meta);
    } catch (e: unknown) {
        log.warn("Could not read the previous snapshot index", { jobId: input.job.id }, wrapError(e));
        previousIndex = null;
    }
    if (!previousIndex) return fresh("the previous backup's file index could not be read");

    // The set of directory sources and their exclude patterns define what a snapshot is
    // supposed to contain. If either changed, carrying files forward would silently keep
    // content the job is no longer configured to back up.
    const previousSources = new Map(previousIndex.directories.map((d) => [d.src, [...d.excludePatterns].sort()]));
    if (previousSources.size !== input.sources.length) {
        return fresh("the set of directory sources changed");
    }
    for (const source of input.sources) {
        const before = previousSources.get(source.jobSourceId);
        if (!before) return fresh("a directory source was added or replaced");
        // Joined on NUL, not a space: patterns may contain spaces, and joining on one
        // would make ["a b"] and ["a", "b"] compare equal - a wrong "unchanged" verdict
        // that would carry files the job no longer wants to back up.
        if (before.join("\u0000") !== [...source.excludePatterns].sort().join("\u0000")) {
            return fresh(`the exclude patterns of a directory source changed`);
        }
    }

    // Every destination must still hold the whole chain. A gap at any of them makes the
    // chain unrestorable from that destination, so the run starts over everywhere.
    const expectedArchives = previous.chainIndex + 1;
    for (const configId of input.destinationConfigIds) {
        if (!(await chainIntactAt(configId, path.posix.join(input.job.name, chainDir), expectedArchives))) {
            return fresh("a destination is missing part of the chain");
        }
    }

    return {
        type: "incremental",
        chainId: previous.chainId,
        index: previous.chainIndex + 1,
        baseArchive: path.posix.basename(previous.remotePath.replace(/\\/g, "/")),
        previousIndex,
        chainDir,
    };
}
