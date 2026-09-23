/**
 * The parts of the job form, and how far each one is filled in.
 *
 * Plain data without React, like the parts of the connection form, so the tests check it without
 * rendering anything.
 */
import type { SectionStatus } from "@/components/adapter/connection-form-layout";
import type { JobFormValues } from "./job-form-schema";

export type JobPartId = "basics" | "source" | "destinations" | "encryption" | "notifications" | "advanced";

export interface JobPart {
    id: JobPartId;
    label: string;
    /** One line under the title, saying what the part is for. */
    description: string;
    /** The fields shown in this part. An error on one of them is counted here. */
    keys: (keyof JobFormValues)[];
}

export const JOB_PARTS: JobPart[] = [
    { id: "basics", label: "Basics", description: "Its name, when it runs and whether it runs on its own.", keys: ["name", "enabled", "scheduleMode", "schedule", "schedulePresetId"] },
    { id: "source", label: "What goes in", description: "A database, folders from storage connections, or both in one backup.", keys: ["sourceMode", "sourceId", "databaseScope", "databases", "directorySources"] },
    { id: "destinations", label: "Destinations", description: "The backup goes to each one in turn, from the top. Each keeps its own backups.", keys: ["destinations"] },
    { id: "encryption", label: "Encryption", description: "Encrypts every backup before it leaves DBackup.", keys: ["encryptionProfileId"] },
    { id: "notifications", label: "Notifications", description: "Who hears about a run, and after which runs.", keys: ["notificationTemplateIds", "notificationIds", "notificationEvents"] },
    {
        id: "advanced",
        label: "Advanced",
        description: "Compression, file names, incremental backups and integrity checks.",
        keys: ["compression", "pgCompressionAlgo", "pgCompressionLevel", "namingTemplateId", "backupMode", "fullEveryDays", "verifyByHash", "skipVerification"],
    },
];

/** The fields that failed validation, from react-hook-form's error tree. */
export function jobErrorKeys(errors: object): string[] {
    return Object.entries(errors)
        .filter(([key, value]) => key !== "root" && Boolean(value))
        .map(([key]) => key);
}

function partOfKey(key: string): JobPartId {
    return JOB_PARTS.find((part) => (part.keys as string[]).includes(key))?.id ?? "basics";
}

/** Whether a part has what the job needs from it. Parts that are all optional have no say. */
function isDone(id: JobPartId, values: JobFormValues): boolean | null {
    switch (id) {
        case "basics":
            return values.name.trim() !== "" && (values.scheduleMode === "own" ? values.schedule.trim() !== "" : Boolean(values.schedulePresetId));
        case "source": {
            const database = values.sourceMode === "dirs" || Boolean(values.sourceId);
            const folders = values.sourceMode === "db"
                || (values.directorySources.length > 0 && values.directorySources.every((source) => source.configId && source.path));
            return database && folders;
        }
        case "destinations":
            return values.destinations.length > 0 && values.destinations.every((destination) => destination.configId);
        default:
            return null;
    }
}

/**
 * How far each part is. Errors win, and a part only shows a check when it needs something
 * and has it, so a part that is all optional stays quiet, as in the connection form.
 */
export function jobPartStatuses(values: JobFormValues, errorKeys: string[]): Record<JobPartId, SectionStatus> {
    const errors = new Map<JobPartId, number>();
    for (const key of new Set(errorKeys)) {
        const id = partOfKey(key);
        errors.set(id, (errors.get(id) ?? 0) + 1);
    }

    const statuses = {} as Record<JobPartId, SectionStatus>;
    for (const part of JOB_PARTS) {
        const count = errors.get(part.id) ?? 0;
        const done = isDone(part.id, values);
        statuses[part.id] = count > 0 ? { kind: "error", count } : done === null ? { kind: "none" } : done ? { kind: "done" } : { kind: "todo" };
    }
    return statuses;
}

/** The first part with an error, in the order the form lists them. */
export function firstPartWithError(errorKeys: string[]): JobPartId | null {
    const failing = new Set(errorKeys.map(partOfKey));
    return JOB_PARTS.find((part) => failing.has(part.id))?.id ?? null;
}
