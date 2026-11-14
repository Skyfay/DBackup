import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { idList, parseJobBody, textList } from "@/lib/core/job-body";
import { jobService } from "@/services/jobs/job-service";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { getJobList } from "@/services/jobs/job-list-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

const log = logger.child({ route: "jobs" });

export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);
        return NextResponse.json(await getJobList());
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        log.error("List jobs error", {}, wrapError(error));
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

        // Checked before anything reads it: an object where an id belongs is a write of its own for Prisma.
        const body = parseJobBody(await req.json());
        const { name, schedule, sourceId, databases, destinations, sources, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, namingTemplateId, schedulePresetId, skipVerification, backupMode, fullEveryDays, verifyByHash } = body;

        if (!name || !schedule || !destinations || destinations.length === 0) {
            return NextResponse.json({ error: "Missing required fields (name, schedule, destinations)" }, { status: 400 });
        }

        const newJob = await jobService.createJob({
            name,
            schedule,
            sourceId: sourceId || undefined,
            databases: Array.isArray(databases) ? databases : [],
            destinations: destinations.map((d, i) => ({
                configId: d.configId,
                priority: d.priority ?? i,
                retention: d.retention ? JSON.stringify(d.retention) : "{}",
                retentionPolicyId: d.retentionPolicyId ?? null,
            })),
            sources: Array.isArray(sources) ? sources.map((s, i) => ({
                configId: s.configId,
                priority: s.priority ?? i,
                path: s.path,
                excludePatterns: textList(s.excludePatterns),
                excludePatternPresetIds: idList(s.excludePatternPresetIds) ?? [],
                // Only forwarded when it really is a boolean, so a client that omits it or
                // sends something else falls through to the column default rather than
                // turning an unrelated value into "do not stop anything".
                ...(typeof s.stopContainers === "boolean" ? { stopContainers: s.stopContainers } : {}),
            })) : undefined,
            notificationIds,
            notificationTemplateIds: idList(notificationTemplateIds),
            enabled,
            encryptionProfileId: encryptionProfileId ?? undefined,
            compression,
            pgCompression,
            notificationEvents,
            namingTemplateId: namingTemplateId ?? null,
            schedulePresetId: schedulePresetId ?? null,
            skipVerification: skipVerification ?? false,
            backupMode: backupMode ?? "FULL",
            fullEveryDays: fullEveryDays ?? 7,
            verifyByHash: verifyByHash ?? false,
        });

        await auditService.logFor(ctx, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.JOB, { name: newJob.name }, newJob.id);

        return NextResponse.json(newJob, { status: 201 });
    } catch (error: unknown) {
        // A linked record of another tenant, a value the job refuses or a name in use is the caller's to fix.
        const refused = serviceRefusal(error);
        if (refused) return refused;
        log.error("Create job error", {}, wrapError(error));
        return NextResponse.json({ error: "The job could not be created. The log of DBackup has the details." }, { status: 500 });
    }
}
