import { Bell, CalendarClock, Database, HardDrive, Lock, type LucideIcon } from "lucide-react";
import { Cron } from "croner";
import { getAdapterDefinition } from "@/lib/adapters/definitions";

export type SetupStepId = "database" | "destination" | "encryption" | "notification" | "job";

/** What a step created or picked. */
export interface SetupEntry {
    id: string;
    name: string;
    /** The adapter of a connection, like "mysql". A key has none. */
    adapterId?: string;
}

export interface SetupJob extends SetupEntry {
    schedule: string;
    notifyOn: NotifyOn;
}

export interface SetupState {
    database: SetupEntry | null;
    destination: SetupEntry | null;
    encryption: SetupEntry | null;
    notification: SetupEntry | null;
    job: SetupJob | null;
    /** Optional steps passed over without an entry. */
    skipped: SetupStepId[];
}

export const EMPTY_SETUP: SetupState = {
    database: null,
    destination: null,
    encryption: null,
    notification: null,
    job: null,
    skipped: [],
};

export interface SetupStep {
    id: SetupStepId;
    title: string;
    /** What the rail says until the step is done. */
    todo: string;
    icon: LucideIcon;
    optional?: boolean;
}

const STEPS: SetupStep[] = [
    { id: "database", title: "Database", todo: "What to back up", icon: Database },
    { id: "destination", title: "Backup destination", todo: "Where backups go", icon: HardDrive },
    { id: "encryption", title: "Encryption", todo: "Optional", icon: Lock, optional: true },
    { id: "notification", title: "Notifications", todo: "Optional", icon: Bell, optional: true },
    { id: "job", title: "Backup job", todo: "Schedule and what goes in", icon: CalendarClock },
];

/** The steps this user can do. Encryption and notifications need the right to create them. */
export function setupSteps({ canCreateVault, canCreateNotification }: { canCreateVault: boolean; canCreateNotification: boolean }): SetupStep[] {
    return STEPS.filter((step) => (step.id !== "encryption" || canCreateVault) && (step.id !== "notification" || canCreateNotification));
}

/** A connection as the rail and the summary name it, "Shop · MySQL". */
export function entryLabel(entry: SetupEntry): string {
    const type = entry.adapterId ? getAdapterDefinition(entry.adapterId)?.name : undefined;
    return type ? `${entry.name} · ${type}` : entry.name;
}

// ------------------------------------------------------------------ schedule

export const SCHEDULES = {
    hourly: "0 * * * *",
    nightly: "0 3 * * *",
    weekly: "0 3 * * 0",
} as const;

export type ScheduleChoice = keyof typeof SCHEDULES | "custom";

export function scheduleChoiceOf(schedule: string): ScheduleChoice {
    const preset = (Object.keys(SCHEDULES) as (keyof typeof SCHEDULES)[]).find((key) => SCHEDULES[key] === schedule);
    return preset ?? "custom";
}

/** When a schedule next fires, read in the time zone the scheduler runs in. Null for one it cannot read. */
export function nextRun(schedule: string, timezone: string, from?: Date): Date | null {
    try {
        return new Cron(schedule.trim(), { timezone }).nextRun(from) ?? null;
    } catch {
        return null;
    }
}

/** How often a job runs, in the words of the schedule cards, "every night". */
export function scheduleName(schedule: string): string {
    switch (scheduleChoiceOf(schedule)) {
        case "hourly":
            return "every hour";
        case "nightly":
            return "every night";
        case "weekly":
            return "every week";
        default:
            return "custom schedule";
    }
}

// ------------------------------------------------------------------ job

/** Run results that send a message, in the pipe list the job stores. */
export const NOTIFY_ON = {
    failures: "PARTIAL|FAILED",
    always: "SUCCESS|PARTIAL|FAILED",
} as const;

export type NotifyOn = (typeof NOTIFY_ON)[keyof typeof NOTIFY_ON];

export type Compression = "NONE" | "GZIP" | "BROTLI";

/** How many backups the setup keeps. The job can switch to a policy later. */
export const KEEP_COUNT = 10;

/** Sources that back up as a whole, so there is nothing to pick from. */
const WHOLE_SOURCES = ["sqlite", "redis", "valkey"];

export function canPickDatabases(adapterId: string | undefined): boolean {
    return !!adapterId && !WHOLE_SOURCES.includes(adapterId);
}

/** PostgreSQL compresses its own dump, and a second pass would only cost time. */
export function compressesItself(adapterId: string | undefined): boolean {
    return adapterId === "postgres";
}

export interface JobChoices {
    name: string;
    schedule: string;
    /** Empty for every database, including ones added later. */
    databases: string[];
    compression: Compression;
    notifyOn: NotifyOn;
}

/** The request that creates the job from what the steps collected. */
export function jobRequest(state: SetupState, choices: JobChoices) {
    return {
        name: choices.name.trim(),
        schedule: choices.schedule.trim(),
        sourceId: state.database?.id,
        databases: canPickDatabases(state.database?.adapterId) ? choices.databases : [],
        destinations: [
            {
                configId: state.destination?.id,
                priority: 0,
                retention: { mode: "SIMPLE", simple: { keepCount: KEEP_COUNT } },
            },
        ],
        encryptionProfileId: state.encryption?.id ?? null,
        compression: compressesItself(state.database?.adapterId) ? "NONE" : choices.compression,
        enabled: true,
        notificationIds: state.notification ? [state.notification.id] : [],
        notificationEvents: choices.notifyOn,
    };
}
