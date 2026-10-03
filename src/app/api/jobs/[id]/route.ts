import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { jobService } from "@/services/jobs/job-service";
import { jobAuditSnapshot, jobChangeDetails } from "@/services/jobs/job-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { PERMANENT_DELETE_REFUSED, permanentlyFrom } from "@/lib/core/delete-mode";

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

    const params = await props.params;
    try {
        // The deleted row still names the job, which is all the entry needs of it. Into Recently
        // deleted, unless `?permanently=true`, which needs the right to change the settings too.
        const permanently = permanentlyFrom(req.nextUrl.searchParams);
        if (permanently && !hasPermissionWithContext(ctx, TRASH_ADMIN_PERMISSION)) {
            return NextResponse.json({ success: false, error: PERMANENT_DELETE_REFUSED }, { status: 403 });
        }
        const deleted = await jobService.deleteJob(params.id, { permanently, by: ctx.userId });
        await auditService.logFor(ctx, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.JOB, { name: deleted.name, ...(permanently ? { permanently: true } : {}) }, params.id);
        return NextResponse.json({ success: true });
    } catch (_error) {
        return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

    const params = await props.params;
    try {
        const body = await req.json();
        const { name, schedule, sourceId, databases, destinations, sources, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, namingTemplateId, schedulePresetId, skipVerification, backupMode, fullEveryDays, verifyByHash } = body;

        const before = await jobAuditSnapshot(params.id);
        const updatedJob = await jobService.updateJob(params.id, {
            name,
            schedule,
            enabled,
            sourceId,
            databases: Array.isArray(databases) ? databases : undefined,
            destinations: destinations ? destinations.map((d: { configId: string; priority?: number; retention?: any; retentionPolicyId?: string | null }, i: number) => ({
                configId: d.configId,
                priority: d.priority ?? i,
                retention: d.retention ? JSON.stringify(d.retention) : "{}",
                retentionPolicyId: d.retentionPolicyId ?? null,
            })) : undefined,
            sources: sources ? sources.map((s: { configId: string; priority?: number; path: string; excludePatterns?: string[]; excludePatternPresetIds?: string[]; stopContainers?: boolean }, i: number) => ({
                configId: s.configId,
                priority: s.priority ?? i,
                path: s.path,
                excludePatterns: Array.isArray(s.excludePatterns) ? s.excludePatterns : [],
                excludePatternPresetIds: Array.isArray(s.excludePatternPresetIds) ? s.excludePatternPresetIds : [],
                // Omitted rather than defaulted when absent: an update that does not mention
                // the setting must leave whatever the user chose alone.
                ...(typeof s.stopContainers === "boolean" ? { stopContainers: s.stopContainers } : {}),
            })) : undefined,
            notificationIds,
            notificationTemplateIds: Array.isArray(notificationTemplateIds) ? notificationTemplateIds : undefined,
            encryptionProfileId,
            compression,
            pgCompression,
            notificationEvents,
            namingTemplateId: namingTemplateId !== undefined ? (namingTemplateId ?? null) : undefined,
            schedulePresetId: schedulePresetId !== undefined ? (schedulePresetId ?? null) : undefined,
            skipVerification: skipVerification !== undefined ? skipVerification : undefined,
            backupMode: backupMode !== undefined ? backupMode : undefined,
            fullEveryDays: fullEveryDays !== undefined ? fullEveryDays : undefined,
            verifyByHash: verifyByHash !== undefined ? verifyByHash : undefined,
        });

        const after = await jobAuditSnapshot(params.id);
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.JOB,
            { ...(before && after ? jobChangeDetails(before, after) : { name: updatedJob.name }) },
            params.id
        );

        return NextResponse.json(updatedJob);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to update job";
        const status = message.includes("already exists") ? 409 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
