import { z } from "zod";
import { NOTIFY_ON, SCHEDULES, nextRun, type SetupEntry } from "./setup-model";

export const jobSchema = z
    .object({
        name: z.string().trim().min(1, "Give the job a name."),
        when: z.enum(["hourly", "nightly", "weekly", "custom"]),
        cron: z.string(),
        scope: z.enum(["all", "some"]),
        databases: z.array(z.string()),
        compression: z.enum(["NONE", "GZIP", "BROTLI"]),
        notifyOn: z.enum([NOTIFY_ON.failures, NOTIFY_ON.always]),
    })
    .superRefine((values, ctx) => {
        if (values.when === "custom" && !nextRun(values.cron, "UTC")) {
            ctx.addIssue({ code: "custom", path: ["cron"], message: "Enter a cron expression with five parts, like 0 3 * * *." });
        }
        if (values.scope === "some" && values.databases.length === 0) {
            ctx.addIssue({ code: "custom", path: ["databases"], message: "Pick at least one database, or back up all of them." });
        }
    });

export type JobValues = z.infer<typeof jobSchema>;

/** What was filled in so far, kept while another step is open. */
export interface JobDraft {
    values: JobValues;
    /** The database it was filled in for, which the picked databases and the first name belong to. */
    source: SetupEntry | null;
}

const nameFor = (database: SetupEntry | null) => `${database?.name ?? "First"} backup`;

export function jobDefaults(database: SetupEntry | null, draft: JobDraft | null): JobValues {
    const fresh: JobValues = {
        name: nameFor(database),
        when: "nightly",
        cron: SCHEDULES.nightly,
        scope: "all",
        databases: [],
        compression: "GZIP",
        notifyOn: NOTIFY_ON.failures,
    };
    if (!draft) return fresh;
    if (draft.source?.id === database?.id) return draft.values;
    // Another database: a name nobody changed follows it, and the databases picked on the old one go.
    const renamed = draft.values.name !== nameFor(draft.source);
    return { ...draft.values, name: renamed ? draft.values.name : fresh.name, scope: "all", databases: [] };
}
