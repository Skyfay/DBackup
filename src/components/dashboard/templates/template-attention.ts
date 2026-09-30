import { firstNameClash } from "@/components/templates/naming-collisions";
import { attentionOf, type TabAttention } from "@/lib/core/tab-attention";
import type { TemplateJob, TemplatesModel } from "@/services/templates/templates-types";
import type { TemplateTab } from "./template-tables";

/** The jobs whose next runs get a name an earlier run already has, like the file names field warns. */
export function clashingJobs(model: TemplatesModel): TemplateJob[] {
    const patterns = new Map(model.naming.flatMap((row) => row.uses.map((use) => [use.jobId, row.pattern] as const)));
    return model.jobs.filter((job) => {
        const pattern = patterns.get(job.id);
        return job.enabled && !job.incremental && pattern !== undefined && firstNameClash(pattern, job.schedule, model.timezone) !== null;
    });
}

/**
 * The dots of the Templates tabs: destinations that keep every backup since no retention policy is
 * the default, and jobs whose runs overwrite each other since their file names repeat.
 */
export function templatesAttention(model: TemplatesModel): Partial<Record<TemplateTab, TabAttention>> {
    const keepAll = model.retention.some((row) => row.isDefault) ? 0 : model.retentionTotals.followDefault;
    return {
        retention: keepAll > 0
            ? { tone: "warning", note: keepAll === 1 ? "1 destination has no policy and keeps every backup" : `${keepAll.toLocaleString()} destinations have no policy and keep every backup` }
            : undefined,
        naming: attentionOf("warning", clashingJobs(model).map((job) => job.name), "overwrites its own backups", "overwrite their own backups"),
    };
}
