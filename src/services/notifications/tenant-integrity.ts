/**
 * The integrity check of every destination is a task of the platform, which hears about all of it.
 * A tenant other than the home tenant hears about the copies its own run of the check went through,
 * its backups at its own destinations and at those another tenant shares with it, with the numbers
 * of those copies, on the channels it picked in its own settings.
 */

import prisma from "@/lib/prisma";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { IntegrityCopy } from "@/services/backup/integrity-service";
import { notify } from "./system-notification-service";

type CheckedCopy = Pick<IntegrityCopy, "destinationId" | "file" | "state" | "expected" | "actual">;

/** A copy with the tenant whose run of the check went through it, the tenant of the backup. */
export type TenantCopy = CheckedCopy & { tenantId: string };

/** The last part of a path, so a copy reads as its file like in the mail of the platform. */
const fileName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/**
 * The copies of each tenant other than the home tenant that had one fail, by the tenant whose run
 * checked them. A copy of a customer on a destination another tenant shares carries the id of that
 * destination, so the tenant of the destination never decides who hears about it.
 */
export async function failuresByTenant(copies: readonly TenantCopy[]): Promise<Map<string, { copies: TenantCopy[]; names: Map<string, string> }>> {
    const tenants = new Set(copies.filter((copy) => copy.state === "failed" && copy.tenantId !== HOME_TENANT_ID).map((copy) => copy.tenantId));
    if (tenants.size === 0) return new Map();
    const told = copies.filter((copy) => tenants.has(copy.tenantId));
    // A provided destination belongs to another tenant, so its name is read across tenants.
    const destinations = await runAsSystem(() => prisma.adapterConfig.findMany({ where: { id: { in: [...new Set(told.map((copy) => copy.destinationId))] } }, select: { id: true, name: true } }));
    const nameOf = new Map(destinations.map((row) => [row.id, row.name]));
    const result = new Map<string, { copies: TenantCopy[]; names: Map<string, string> }>();
    for (const tenantId of tenants) {
        const own = told.filter((copy) => copy.tenantId === tenantId);
        result.set(tenantId, { copies: own, names: new Map(own.map((copy) => [copy.destinationId, nameOf.get(copy.destinationId) ?? copy.destinationId])) });
    }
    return result;
}

/** Tells each tenant whose copies failed the check about them, on its own channels only. Never throws. */
export async function notifyTenantsOfIntegrity(copies: readonly TenantCopy[], triggerType: "Scheduler" | "Manual" | "Api"): Promise<void> {
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
