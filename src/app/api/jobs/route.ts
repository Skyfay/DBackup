import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { jobService } from "@/services/jobs/job-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { Cron } from "croner";
import prisma from "@/lib/prisma";

const log = logger.child({ route: "jobs" });

export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);

        const [jobs, tzSetting] = await Promise.all([
            jobService.getJobs(),
            prisma.systemSetting.findUnique({ where: { key: "system.timezone" } }),
        ]);
        const timezone = tzSetting?.value || "UTC";

        const enriched = jobs.map(({ executions, schedulePreset, ...job }) => {
            const lastRunAt = executions[0]?.startedAt?.toISOString() ?? null;

            let nextRunAt: string | null = null;
            if (job.enabled) {
                const effectiveSchedule = schedulePreset?.schedule ?? job.schedule;
                try {
                    const cronJob = new Cron(effectiveSchedule, { timezone });
                    const next = cronJob.nextRun();
                    nextRunAt = next ? next.toISOString() : null;
                } catch {
                    // Invalid cron expression - leave nextRunAt null
                }
            }

            return { ...job, schedulePreset, lastRunAt, nextRunAt };
        });

        return NextResponse.json(enriched);
    } catch (_error) {
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

        const body = await req.json();
        const { name, schedule, sourceId, databases, destinations, sources, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, namingTemplateId, schedulePresetId, skipVerification, backupMode, fullEveryDays, verifyByHash } = body;

        if (!name || !schedule || !destinations || !Array.isArray(destinations) || destinations.length === 0) {
            return NextResponse.json({ error: "Missing required fields (name, schedule, destinations)" }, { status: 400 });
        }

        const newJob = await jobService.createJob({
            name,
            schedule,
            sourceId: sourceId || undefined,
            databases: Array.isArray(databases) ? databases : [],
            destinations: destinations.map((d: { configId: string; priority?: number; retention?: any; retentionPolicyId?: string | null }, i: number) => ({
                configId: d.configId,
                priority: d.priority ?? i,
                retention: d.retention ? JSON.stringify(d.retention) : "{}",
                retentionPolicyId: d.retentionPolicyId ?? null,
            })),
            sources: Array.isArray(sources) ? sources.map((s: { configId: string; priority?: number; path: string; excludePatterns?: string[]; excludePatternPresetIds?: string[] }, i: number) => ({
                configId: s.configId,
                priority: s.priority ?? i,
                path: s.path,
                excludePatterns: Array.isArray(s.excludePatterns) ? s.excludePatterns : [],
                excludePatternPresetIds: Array.isArray(s.excludePatternPresetIds) ? s.excludePatternPresetIds : [],
            })) : undefined,
            notificationIds,
            notificationTemplateIds: Array.isArray(notificationTemplateIds) ? notificationTemplateIds : undefined,
            enabled,
            encryptionProfileId,
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

        return NextResponse.json(newJob, { status: 201 });
    } catch (error: unknown) {
        log.error("Create job error", {}, wrapError(error));
        const message = error instanceof Error ? error.message : "Failed to create job";
        const status = message.includes("already exists") ? 409 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
