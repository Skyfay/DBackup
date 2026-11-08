/**
 * Weeks of made-up history for the jobs and destinations of the lab: a run of every job every
 * hour, a few of them failed, and a storage snapshot of every destination every hour. Enough for
 * the dashboard, the History page and the storage charts to show something. Replaces the runs of
 * the lab jobs it made before, never the ones that really ran.
 */

import prisma from "@/lib/prisma";

const DAYS = 30;
const HOUR = 3_600_000;
const BATCH = 500;
const SEEDED = "lab:history";

export async function seedHistory(): Promise<string> {
    const jobs = await prisma.job.findMany({ where: { name: { startsWith: "Lab " } }, select: { id: true, name: true } });
    const destinations = await prisma.adapterConfig.findMany({
        where: { name: { startsWith: "Lab " }, type: "storage", storageRole: "DESTINATION" },
        select: { id: true, name: true, adapterId: true },
    });

    await prisma.execution.deleteMany({ where: { triggerLabel: SEEDED } });
    await prisma.storageSnapshot.deleteMany({ where: { adapterConfigId: { in: destinations.map((destination) => destination.id) } } });

    const now = Date.now();
    const executions = [];
    for (let hour = DAYS * 24; hour >= 1; hour--) {
        for (const [index, job] of jobs.entries()) {
            const startedAt = new Date(now - hour * HOUR + index * 60_000);
            // About one run in 150 fails, the same ones on every seed.
            const failed = (hour * 31 + index * 17) % 150 === 0;
            const seconds = 5 + ((hour * 7 + index * 13) % 300);
            executions.push({
                jobId: job.id,
                type: "Backup",
                status: failed ? "Failed" : "Success",
                startedAt,
                endedAt: new Date(startedAt.getTime() + seconds * 1000),
                size: failed ? null : BigInt(1_000_000 + ((hour * 104_729 + index) % 50_000_000)),
                triggerType: "Scheduler",
                triggerLabel: SEEDED,
                metadata: JSON.stringify({ jobName: job.name }),
                logs: JSON.stringify([
                    { timestamp: startedAt.toISOString(), level: "info", type: "general", message: "Made by pnpm lab:seed --history", stage: "Queued" },
                    ...(failed ? [{ timestamp: startedAt.toISOString(), level: "error", type: "general", message: "Connection refused (made up by the lab)", stage: "Dump" }] : []),
                ]),
            });
        }
    }
    for (let start = 0; start < executions.length; start += BATCH) {
        await prisma.execution.createMany({ data: executions.slice(start, start + BATCH) });
    }

    const snapshots = [];
    for (let hour = DAYS * 24; hour >= 0; hour--) {
        for (const [index, destination] of destinations.entries()) {
            // Grows over the month with a dip every week, when retention deletes old backups.
            const size = (index + 1) * 2e9 + (DAYS * 24 - hour) * 3e6 - (hour % 168 === 0 ? 5e8 : 0);
            snapshots.push({
                adapterConfigId: destination.id,
                adapterName: destination.name,
                adapterId: destination.adapterId,
                size: BigInt(Math.round(size)),
                count: 20 + Math.floor((DAYS * 24 - hour) / 24),
                createdAt: new Date(now - hour * HOUR),
            });
        }
    }
    for (let start = 0; start < snapshots.length; start += BATCH) {
        await prisma.storageSnapshot.createMany({ data: snapshots.slice(start, start + BATCH) });
    }

    return `made ${executions.length} runs and ${snapshots.length} storage snapshots over ${DAYS} days`;
}
