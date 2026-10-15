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

/**
 * Whether the sidebar offers Quick Setup: while no database is set up, or always once General
 * says so.
 */
export async function showsQuickSetup(): Promise<boolean> {
    const [databases, setting] = await Promise.all([
        prisma.adapterConfig.count({ where: { type: "database" } }),
        prisma.systemSetting.findUnique({ where: { key: "general.showQuickSetup" }, select: { value: true } }),
    ]);
    return setting?.value === "true" || databases === 0;
}
