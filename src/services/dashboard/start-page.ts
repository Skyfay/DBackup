import prisma from "@/lib/prisma";

/**
 * True while the instance has nothing to back up: no database, no directory source, no
 * destination and no job. Notification channels do not count, a channel alone backs up nothing.
 */
export async function hasNothingToBackUp(): Promise<boolean> {
    const [connections, jobs] = await Promise.all([
        prisma.adapterConfig.count({ where: { type: { in: ["database", "storage"] } } }),
        prisma.job.count(),
    ]);
    return connections === 0 && jobs === 0;
}
