import type { RetentionConfiguration } from "@/lib/core/retention";

/**
 * The Templates page: the five kinds of templates, each with what uses it. Plain data, so the
 * page gets it as JSON and the rules can be tested without a database.
 */

/** A job as the templates name it. */
export interface TemplateJob {
    id: string;
    name: string;
    enabled: boolean;
    /** The schedule the scheduler reads, the one of its preset when it follows one. */
    schedule: string;
    sourceType: string | null;
    hasFolders: boolean;
    /** Whether it builds incremental chains, whose place in the chain is part of every file name. */
    incremental: boolean;
    /** The databases it backs up, which a file name can hold. */
    databases: string[];
}

/** What every kind has in common. */
export interface TemplateBase {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
}

/** Whether a job picked the template itself or follows the default for want of its own. */
export type TemplateHow = "picked" | "default";

/** A destination of a job and how it came to its retention policy. */
export interface RetentionUse {
    jobId: string;
    destinationId: string;
    destinationName: string;
    adapterId: string;
    how: TemplateHow;
}

/** A connection that starts the destinations of new jobs with a policy, set on the Connections page. */
export interface TemplateConnection {
    id: string;
    name: string;
    adapterId: string;
}

export interface RetentionRow extends TemplateBase {
    config: RetentionConfiguration;
    isDefault: boolean;
    isSystem: boolean;
    uses: RetentionUse[];
    prefills: TemplateConnection[];
}

/** The destinations of every job, by how they come to their policy. */
export interface RetentionTotals {
    destinations: number;
    picked: number;
    /** Neither a policy nor a setting of their own, so the default decides, or nothing is removed without one. */
    followDefault: number;
    /** A setting saved in the job before templates existed. */
    own: number;
}

export interface NamingRow extends TemplateBase {
    pattern: string;
    isDefault: boolean;
    isSystem: boolean;
    uses: { jobId: string; how: TemplateHow }[];
}

/** The jobs by how they name their files. */
export interface NamingTotals {
    jobs: number;
    picked: number;
    followDefault: number;
}

export interface ScheduleRow extends TemplateBase {
    schedule: string;
    jobIds: string[];
}

/** A channel of a notification template, shaped like the template dialog takes it. */
export interface NotificationChannelRow {
    id: string;
    configId: string;
    /** Pipe-separated, like "PARTIAL|FAILED". */
    events: string;
    config: TemplateConnection;
}

export interface NotificationRow extends TemplateBase {
    isDefault: boolean;
    isSystem: boolean;
    channels: NotificationChannelRow[];
    jobIds: string[];
}

/** A folder of a job that skips what a preset names. */
export interface ExcludeFolder {
    /** The folder itself, one source of the job. */
    id: string;
    jobId: string;
    connectionId: string;
    connectionName: string;
    adapterId: string;
    path: string;
}

export interface ExcludeRow extends TemplateBase {
    /** Its own patterns, on top of the groups. */
    patterns: string[];
    groups: string[];
    /** Patterns of its groups it leaves out. */
    excludedGroupPatterns: string[];
    isDefault: boolean;
    isSystem: boolean;
    folders: ExcludeFolder[];
}

export interface TemplatesModel {
    /** The time zone the scheduler reads schedules and names files in. */
    timezone: string;
    jobs: TemplateJob[];
    retention: RetentionRow[];
    retentionTotals: RetentionTotals;
    naming: NamingRow[];
    namingTotals: NamingTotals;
    schedules: ScheduleRow[];
    notifications: NotificationRow[];
    excludes: ExcludeRow[];
    /** The folders of every job, and how many of them skip what a preset names. */
    folders: { total: number; withPreset: number };
    /** Every notification connection a template can send through. */
    channels: TemplateConnection[];
}

/** A destination whose next run a change of its retention policy reaches, with the backups it holds now. */
export interface RetentionTarget {
    jobId: string;
    jobName: string;
    destinationId: string;
    destinationName: string;
    adapterId: string;
    how: TemplateHow;
    /** When the job runs next by its schedule, null for one that is paused or has none. */
    nextRun: string | null;
    /** Whether the job builds incremental chains, which the retention removes as a whole. */
    chains: boolean;
    backups: { at: string; locked: boolean; chainId: string | null }[];
}

export interface RetentionTargets {
    timezone: string;
    targets: RetentionTarget[];
    /** Destinations whose listing is not cached yet, so their backups are not counted. */
    unlisted: string[];
}
