"use client";

import { firstNameClash } from "@/components/templates/naming-collisions";
import { readCron } from "@/lib/core/cron";
import { applyNamingPattern, fileNameParts } from "@/lib/templates/naming-template-engine";
import { cn } from "@/lib/utils";
import type { NamingRow, TemplateJob } from "@/services/templates/templates-types";

const DATE_PARTS = new Set(["yyyy", "MM", "dd", "HH", "mm", "ss"]);

/** A file name pattern with its tokens and date parts marked, the rest as typed. */
export function TokenPattern({ pattern, className }: { pattern: string; className?: string }) {
    const parts = pattern.split(/(\{[a-z_]+\}|yyyy|MM|dd|HH|mm|ss)/).filter(Boolean);
    return (
        <span className={cn("font-mono text-xs break-all", className)}>
            {parts.map((part, index) =>
                part.startsWith("{") ? (
                    <span key={index} className="rounded-sm bg-foreground/10 px-1 font-medium">{part}</span>
                ) : DATE_PARTS.has(part) ? (
                    <span key={index} className="font-medium underline decoration-foreground/30 underline-offset-2">{part}</span>
                ) : (
                    <span key={index} className="text-muted-foreground">{part}</span>
                )
            )}
        </span>
    );
}

/** The name the next backup of a job gets from a pattern, the way the runner writes it. */
export function nextFileOf(pattern: string, job: TemplateJob, timezone: string, now = new Date()): string {
    const { jobName, dbName } = fileNameParts(job.name, job.databases);
    const at = (job.enabled ? readCron(job.schedule, timezone)?.nextRun(now) : null) ?? now;
    return `${applyNamingPattern(pattern, jobName, dbName, at, timezone)}.tar`;
}

/** A name from a pattern for a job called Shop nightly, for a template no job uses. */
export function sampleFileOf(pattern: string, timezone: string, now = new Date()): string {
    return `${applyNamingPattern(pattern, "Shop_nightly", "shop", now, timezone)}.tar`;
}

/** The jobs of a template whose runs get a name an earlier run already has, so the later replaces it. */
export function clashingJobs(row: NamingRow, jobs: Map<string, TemplateJob>, timezone: string): TemplateJob[] {
    return row.uses
        .map((use) => jobs.get(use.jobId))
        .filter((job): job is TemplateJob => job !== undefined && job.enabled && !job.incremental && firstNameClash(row.pattern, job.schedule, timezone) !== null);
}
