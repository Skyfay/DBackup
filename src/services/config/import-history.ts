import { exists, idHere, type ImportContext } from "./import-context";

/** Runs, the audit log, notifications and the storage history, each linked only to what is here. */
export async function importStatistics({ tx, data, ids, known }: ImportContext): Promise<void> {
    const statistics = data.statistics;
    if (!statistics) return;

    for (const snapshot of statistics.storageSnapshots ?? []) {
        await tx.storageSnapshot.upsert({ where: { id: snapshot.id }, create: snapshot, update: snapshot });
    }

    for (const execution of statistics.executions ?? []) {
        const remapped = { ...execution };
        if (remapped.jobId) {
            const jobId = idHere(ids.jobs, remapped.jobId);
            remapped.jobId = (await exists(known.jobs, jobId, () => tx.job.findUnique({ where: { id: jobId }, select: { id: true } }))) ? jobId : null;
        }
        await tx.execution.upsert({ where: { id: remapped.id }, create: remapped, update: remapped });
    }

    for (const auditLog of statistics.auditLogs ?? []) {
        const remapped = { ...auditLog };
        if (remapped.userId) {
            const userId = idHere(ids.users, remapped.userId);
            remapped.userId = (await exists(known.users, userId, () => tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) ? userId : null;
        }
        await tx.auditLog.upsert({ where: { id: remapped.id }, create: remapped, update: remapped });
    }

    for (const notifLog of statistics.notificationLogs ?? []) {
        await tx.notificationLog.upsert({ where: { id: notifLog.id }, create: notifLog, update: notifLog });
    }
}
