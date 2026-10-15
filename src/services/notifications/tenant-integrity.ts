/**
 * The integrity check of every destination is a task of the platform, which hears about all of it.
 * A tenant other than the home tenant hears about the copies at its own destinations alone, with
 * the numbers of those copies, on the channels it picked in its own settings.
 */

import prisma from "@/lib/prisma";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { IntegrityCopy } from "@/services/backup/integrity-service";
import { notify } from "./system-notification-service";

type CheckedCopy = Pick<IntegrityCopy, "destinationId" | "file" | "state" | "expected" | "actual">;

/** The last part of a path, so a copy reads as its file like in the mail of the platform. */
const fileName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** The copies of each tenant other than the home tenant that had one fail, by the tenant of its destination. */
export async function failuresByTenant(copies: readonly CheckedCopy[]): Promise<Map<string, { copies: CheckedCopy[]; names: Map<string, string> }>> {
    const failedAt = [...new Set(copies.filter((copy) => copy.state === "failed").map((copy) => copy.destinationId))];
    if (failedAt.length === 0) return new Map();
    const destinations = await runAsSystem(() => prisma.adapterConfig.findMany({ where: { id: { in: [...new Set(copies.map((copy) => copy.destinationId))] } }, select: { id: true, name: true, tenantId: true } }));
    const owner = new Map(destinations.map((row) => [row.id, row]));
    const tenants = new Set(failedAt.flatMap((id) => {
        const tenantId = owner.get(id)?.tenantId;
        return tenantId && tenantId !== HOME_TENANT_ID ? [tenantId] : [];
    }));
    const result = new Map<string, { copies: CheckedCopy[]; names: Map<string, string> }>();
    for (const tenantId of tenants) {
        const own = copies.filter((copy) => owner.get(copy.destinationId)?.tenantId === tenantId);
        result.set(tenantId, { copies: own, names: new Map(own.map((copy) => [copy.destinationId, owner.get(copy.destinationId)?.name ?? copy.destinationId])) });
    }
    return result;
}

/** Tells each tenant whose copies failed the check about them, on its own channels only. Never throws. */
export async function notifyTenantsOfIntegrity(copies: readonly CheckedCopy[], triggerType: "Scheduler" | "Manual" | "Api"): Promise<void> {
    for (const [tenantId, { copies: own, names }] of await failuresByTenant(copies)) {
        const failed = own.filter((copy) => copy.state === "failed");
        await notify({
            eventType: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
            data: {
                totalFiles: own.length,
                failed: failed.length,
                passed: own.filter((copy) => copy.state === "passed").length,
                skipped: own.filter((copy) => copy.state === "skipped").length,
                triggerType,
                errors: failed.map((copy) => ({ file: fileName(copy.file), destination: names.get(copy.destinationId) ?? copy.destinationId, expected: copy.expected ?? "", actual: copy.actual ?? "" })),
            },
        }, { tenantId, platform: false });
    }
}
