/**
 * A Vault key and a handful of jobs that each try something else: encryption, retention, several
 * destinations, an incremental directory backup and a notification. Every job starts paused, so
 * nothing runs on its own. Run now still starts it.
 */

import prisma from "@/lib/prisma";
import { createEncryptionProfile } from "@/services/backup/encryption-service";
import { jobService } from "@/services/jobs/job-service";
import type { SeededConnections } from "./connections";

const KEEP_TEN = JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 10 } });
/** The Smart GFS policy every installation gets from its migrations. */
const SMART_GFS = "retention-gvs-default";

interface JobSpec {
    name: string;
    source: string;
    destinations: string[];
    encrypted?: boolean;
    retentionPolicyId?: string;
    notify?: string[];
    incremental?: boolean;
}

const JOBS: JobSpec[] = [
    { name: "Lab PostgreSQL 18 to Local", source: "postgres-18", destinations: ["local"], encrypted: true, retentionPolicyId: SMART_GFS, notify: ["mail"] },
    { name: "Lab MySQL 9 to S3", source: "mysql-9", destinations: ["s3"], notify: ["ntfy"] },
    { name: "Lab MariaDB 11.8 to WebDAV and Local", source: "mariadb-118", destinations: ["webdav", "local"], encrypted: true },
    { name: "Lab MongoDB 8.0 to SFTP", source: "mongo-80", destinations: ["sftp"], notify: ["gotify"] },
    { name: "Lab SQL Server 2022 to FTP", source: "mssql-2022", destinations: ["ftp"] },
    { name: "Lab Redis 8 to SMB", source: "redis-8", destinations: ["smb"], notify: ["webhook"] },
    { name: "Lab Firebird 5 to Rsync", source: "firebird-5", destinations: ["rsync"] },
    { name: "Lab PostgreSQL 12 over SSH to Local", source: "postgres-12-ssh", destinations: ["local"] },
    { name: "Lab SQLite to Local", source: "sqlite", destinations: ["local"] },
    { name: "Lab Files incremental to Local", source: "files", destinations: ["local"], incremental: true },
];

async function ensureVaultKey(): Promise<string> {
    const existing = await prisma.encryptionProfile.findFirst({ where: { name: "Lab key" } });
    if (existing) return existing.id;
    return (await createEncryptionProfile("Lab key", "Created by the dev lab seed")).id;
}

/** Two jobs for each native host: PostgreSQL to SFTP, and MySQL through the mysqldump of Ubuntu. */
function nativeJobs(hosts: string[]): JobSpec[] {
    return hosts.flatMap((host) => [
        { name: `Lab ${host} PostgreSQL to SFTP`, source: `${host}-postgres`, destinations: ["sftp"], encrypted: true },
        { name: `Lab ${host} MySQL to Local`, source: `${host}-mysql`, destinations: ["local"] },
    ]);
}

export async function seedJobs(connections: SeededConnections, nativeHosts: string[] = []): Promise<string[]> {
    const log: string[] = [];
    const keyId = await ensureVaultKey();

    for (const job of [...JOBS, ...nativeJobs(nativeHosts)]) {
        if (await prisma.job.findFirst({ where: { name: job.name } })) {
            log.push(`kept job ${job.name}`);
            continue;
        }
        const sourceId = connections.sources.get(job.source);
        const destinationIds = job.destinations.map((key) => connections.destinations.get(key));
        if (!sourceId || destinationIds.some((id) => !id)) {
            log.push(`skipped job ${job.name}, its source or a destination is not in this lab`);
            continue;
        }

        await jobService.createJob({
            name: job.name,
            schedule: "0 3 * * *",
            enabled: false,
            ...(job.incremental
                ? { sources: [{ configId: sourceId, priority: 0, path: "/" }], backupMode: "INCREMENTAL", fullEveryDays: 7 }
                : { sourceId, databases: [] }),
            destinations: destinationIds.map((configId, priority) => ({
                configId: configId!,
                priority,
                retention: KEEP_TEN,
                retentionPolicyId: job.retentionPolicyId ?? null,
            })),
            encryptionProfileId: job.encrypted ? keyId : undefined,
            compression: "GZIP",
            notificationIds: (job.notify ?? []).map((key) => connections.channels.get(key)).filter((id): id is string => !!id),
            notificationEvents: "ALWAYS",
        });
        log.push(`created job ${job.name}`);
    }
    return log;
}
