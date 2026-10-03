import { logger } from "@/lib/logging/logger";
import { counted, exists, idHere, listed, type ImportContext } from "./import-context";

const svcLog = logger.child({ service: "ConfigService" });

/** What a destination keeps while its retention policy is not here: every backup. */
const KEEP_EVERYTHING = JSON.stringify({ mode: "NONE" });

/** "2 jobs are paused, ...: Shop and CRM." with the verb that fits the count. */
function jobsNote(names: string[], one: string, many: string): string {
    return `${counted(names.length, one, many)}: ${listed(names)}.`;
}

/**
 * Jobs with their destinations and channels. A file of this version holds no templates and no
 * folders, so a link to one that is not here is dropped, and the notes say what that changes.
 */
export async function importJobs(ctx: ImportContext): Promise<void> {
    const { tx, data, ids, known, notes } = ctx;
    const pausedForKey: string[] = [];
    const defaultNames: string[] = [];
    const ownSchedule: string[] = [];
    const withoutSource: string[] = [];

    for (const jobItem of data.jobs) {
        const job = { ...jobItem };

        if (job.sourceId) {
            const sourceId = idHere(ids.adapters, job.sourceId);
            const found = await exists(known.adapters, sourceId, () => tx.adapterConfig.findUnique({ where: { id: sourceId }, select: { id: true } }));
            job.sourceId = found ? sourceId : null;
            if (!found) withoutSource.push(job.name);
        }

        if (job.encryptionProfileId) {
            const profileId = idHere(ids.profiles, job.encryptionProfileId);
            if (await exists(known.profiles, profileId, () => tx.encryptionProfile.findUnique({ where: { id: profileId }, select: { id: true } }))) {
                job.encryptionProfileId = profileId;
            } else {
                svcLog.warn("Removing invalid encryption profile from job", { encryptionProfileId: profileId, jobName: job.name });
                job.encryptionProfileId = null;
                // Without its key the job would write its next backups unencrypted, so it waits.
                if (job.enabled !== false) pausedForKey.push(job.name);
                job.enabled = false;
            }
        }

        if (job.namingTemplateId && !(await tx.namingTemplate.findUnique({ where: { id: job.namingTemplateId }, select: { id: true } }))) {
            job.namingTemplateId = null;
            defaultNames.push(job.name);
        }
        // Without its preset the job runs on the schedule it has itself, the last one the preset gave it.
        if (job.schedulePresetId && !(await tx.schedulePreset.findUnique({ where: { id: job.schedulePresetId }, select: { id: true } }))) {
            job.schedulePresetId = null;
            ownSchedule.push(job.name);
        }

        // A job of the same name here takes the one of the file and keeps its id.
        const existingJob = await tx.job.findFirst({ where: { name: job.name } });
        if (existingJob && existingJob.id !== job.id) {
            const { id: _id, ...updateFields } = job;
            await tx.job.update({ where: { id: existingJob.id }, data: updateFields });
            ids.jobs.set(job.id, existingJob.id);
            known.jobs.add(existingJob.id);
        } else {
            await tx.job.upsert({ where: { id: job.id }, create: job, update: job });
            known.jobs.add(job.id);
        }
    }

    const { keptEverything, leftOut } = await importJobDestinations(ctx);
    await importJobChannels(ctx);

    // A job without a database backs up folders, which the file does not hold.
    const withoutFolders: string[] = [];
    for (const job of data.jobs) {
        if (job.sourceId) continue;
        if ((await tx.jobSource.count({ where: { jobId: idHere(ids.jobs, job.id) } })) > 0) continue;
        withoutFolders.push(job.name);
    }

    if (pausedForKey.length > 0) notes.push(jobsNote(pausedForKey, "job is paused so it does not back up unencrypted, its encryption key is not here", "jobs are paused so they do not back up unencrypted, their encryption key is not here"));
    if (keptEverything > 0) notes.push(`${counted(keptEverything, "job destination keeps", "job destinations keep")} every backup until a retention policy is picked again, since the file holds no retention policies.`);
    if (defaultNames.length > 0) notes.push(jobsNote(defaultNames, "job uses the default file names, since the file holds no naming templates", "jobs use the default file names, since the file holds no naming templates"));
    if (ownSchedule.length > 0) notes.push(jobsNote(ownSchedule, "job runs on its own schedule, since the file holds no schedule presets", "jobs run on their own schedule, since the file holds no schedule presets"));
    if (withoutSource.length > 0) notes.push(jobsNote(withoutSource, "job has no database to back up, its connection is not here", "jobs have no database to back up, their connection is not here"));
    if (withoutFolders.length > 0) notes.push(jobsNote(withoutFolders, "job backs up no folders until it gets them again, since the file holds no folders", "jobs back up no folders until they get them again, since the file holds no folders"));
    if (leftOut > 0) notes.push(`${counted(leftOut, "destination of a job was", "destinations of jobs were")} left out, since the job or the connection is not here.`);
}

/** The destinations of every job, on the ids the jobs and connections have here. */
async function importJobDestinations({ tx, data, ids, known }: ImportContext): Promise<{ keptEverything: number; leftOut: number }> {
    let keptEverything = 0;
    let leftOut = 0;

    for (const dest of data.jobDestinations ?? []) {
        const row = { ...dest, jobId: idHere(ids.jobs, dest.jobId), configId: idHere(ids.adapters, dest.configId) };
        const jobHere = await exists(known.jobs, row.jobId, () => tx.job.findUnique({ where: { id: row.jobId }, select: { id: true } }));
        const destinationHere = await exists(known.adapters, row.configId, () => tx.adapterConfig.findUnique({ where: { id: row.configId }, select: { id: true } }));
        if (!jobHere || !destinationHere) {
            leftOut++;
            continue;
        }

        // Without its policy the destination would fall back to the default one, which may remove
        // backups the old policy kept. It keeps everything until someone picks a policy again.
        if (row.retentionPolicyId && !(await tx.retentionPolicy.findUnique({ where: { id: row.retentionPolicyId }, select: { id: true } }))) {
            row.retentionPolicyId = null;
            row.retention = KEEP_EVERYTHING;
            keptEverything++;
        }

        // A job that merged into one of the same name may have this destination already, under another id.
        const same = await tx.jobDestination.findUnique({ where: { jobId_configId: { jobId: row.jobId, configId: row.configId } } });
        if (same && same.id !== row.id) {
            const { id: _id, ...fields } = row;
            await tx.jobDestination.update({ where: { id: same.id }, data: fields });
        } else {
            await tx.jobDestination.upsert({ where: { id: row.id }, create: row, update: row });
        }
    }
    return { keptEverything, leftOut };
}

/** The notification channels a job names directly, the ones that are here. */
async function importJobChannels({ tx, data, ids, known }: ImportContext): Promise<void> {
    for (const [jobId, channelIds] of Object.entries(data.jobNotifications ?? {})) {
        const jobHere = idHere(ids.jobs, jobId);
        if (!(await exists(known.jobs, jobHere, () => tx.job.findUnique({ where: { id: jobHere }, select: { id: true } })))) continue;

        const here: string[] = [];
        for (const channelId of channelIds.map((id) => idHere(ids.adapters, id))) {
            if (await exists(known.adapters, channelId, () => tx.adapterConfig.findUnique({ where: { id: channelId }, select: { id: true } }))) here.push(channelId);
        }
        await tx.job.update({ where: { id: jobHere }, data: { notifications: { set: here.map((id) => ({ id })) } } });
    }
}
