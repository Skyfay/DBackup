import type { BackupResultData, NotificationPayload, TemplateOptions } from "../types";
import { action, ago, duration, formatterFor, names, paths, plural, size, startedBy } from "./format";

/** The three outcomes of a backup run, which the runner sends to the channels of the job. */

function source(data: BackupResultData): string | undefined {
    if (!data.sourceName) return undefined;
    return data.sourceType ? `${data.sourceName} · ${data.sourceType}` : data.sourceName;
}

function started(data: BackupResultData, options?: TemplateOptions): string | undefined {
    const at = formatterFor(options).date(data.startedAt ?? data.timestamp);
    const by = startedBy(data.trigger);
    if (!at) return undefined;
    if (by === "Schedule") return `${at} by schedule`;
    if (by === "By hand") return `${at} by hand`;
    if (by === "API") return `${at} through the API`;
    return at;
}

function runActions(data: BackupResultData) {
    return [
        ...action("Open run", data.executionId ? paths.run(data.executionId) : undefined, "history"),
        ...action("Open job", data.jobId ? paths.job(data.jobId) : undefined, "calendar-clock"),
    ];
}

function baseFields(data: BackupResultData, options?: TemplateOptions) {
    return [
        { name: "Job", value: data.jobName, inline: true },
        ...(data.sourceName ? [{ name: "Source", value: data.sourceName, inline: true }] : []),
        ...(data.duration !== undefined ? [{ name: "Duration", value: duration(data.duration), inline: true }] : []),
        ...(data.size !== undefined ? [{ name: "Size", value: size(data.size), inline: true }] : []),
    ].concat([{ name: "Time", value: formatterFor(options).date(data.timestamp) ?? data.timestamp, inline: true }]);
}

function stat(label: string, value: string | undefined) {
    return value ? [{ label, value }] : [];
}

export function backupSuccessTemplate(data: BackupResultData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const done = (data.destinations ?? []).filter((dest) => dest.state === "ok");
    const what = data.databases
        ? `${plural(data.databases, "database")}${data.sourceName ? ` from ${data.sourceName}` : ""}`
        : data.sourceName ? `The backup of ${data.sourceName}` : "The backup";
    const message = done.length > 0
        ? `${what} ${data.databases && data.databases > 1 ? "are" : "is"} now in ${plural(done.length, "destination")}.`
        : `${data.jobName} finished${data.duration !== undefined ? ` in ${duration(data.duration)}` : ""}.`;
    return {
        title: `${data.jobName} finished`,
        message,
        preheader: done.length > 0
            ? `${data.size !== undefined ? size(data.size) : "The backup"} went to ${names(done.map((dest) => dest.name))}${data.duration !== undefined ? ` in ${duration(data.duration)}` : ""}.`
            : message,
        fields: baseFields(data, options),
        color: "#22c55e",
        success: true,
        tone: "success",
        icon: "circle-check",
        stats: [
            ...stat("Started", f.time(data.startedAt)),
            ...stat("Duration", data.duration !== undefined ? duration(data.duration) : undefined),
            ...stat("Size", data.size !== undefined ? size(data.size) : undefined),
            ...stat("Trigger", startedBy(data.trigger)),
        ],
        destinations: data.destinations,
        details: [
            { name: "Job", value: data.jobName },
            ...(source(data) ? [{ name: "Source", value: source(data)! }] : []),
            ...(data.encryptionKey ? [{ name: "Encrypted", value: `with ${data.encryptionKey}` }] : []),
        ],
        actions: runActions(data).slice(0, 1),
        timestamp: data.timestamp,
    };
}

export function backupPartialTemplate(data: BackupResultData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const all = data.destinations ?? [];
    const done = all.filter((dest) => dest.state === "ok");
    const failed = all.filter((dest) => dest.state === "failed");
    const message = all.length > 0
        ? `${done.length} of ${plural(all.length, "destination")} got the backup.${failed.length ? ` ${names(failed.map((dest) => dest.name), 3)} did not.` : ""}`
        : "Some destinations did not get the backup.";
    return {
        title: `${data.jobName} finished partially`,
        message,
        preheader: data.problem ? `${message} ${data.problem.title}.` : message,
        fields: [
            ...baseFields(data, options).slice(0, -1),
            ...(failed.length ? [{ name: "Failed", value: failed.map((dest) => dest.name).join(", "), inline: false }] : []),
            ...(data.error ? [{ name: "Details", value: data.error, inline: false }] : []),
            baseFields(data, options).at(-1)!,
        ],
        color: "#f97316",
        success: false,
        badge: "Partial",
        tone: "warning",
        icon: "triangle-alert",
        stats: [
            ...stat("Started", f.time(data.startedAt)),
            ...stat("Duration", data.duration !== undefined ? duration(data.duration) : undefined),
            ...stat("Size", data.size !== undefined ? size(data.size) : undefined),
            ...stat("Destinations", all.length ? `${done.length} of ${all.length}` : undefined),
        ],
        problem: data.problem,
        destinations: data.destinations,
        details: [
            { name: "Job", value: data.jobName },
            ...(source(data) ? [{ name: "Source", value: source(data)! }] : []),
            ...(started(data, options) ? [{ name: "Started", value: started(data, options)! }] : []),
        ],
        actions: runActions(data),
        timestamp: data.timestamp,
    };
}

export function backupFailureTemplate(data: BackupResultData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const step = data.problem?.where?.split(" · ")[0]?.toLowerCase();
    const nothing = !(data.destinations ?? []).some((dest) => dest.state === "ok");
    const message = `The run stopped${step ? ` while ${step}` : " with an error"}${nothing ? ", so no destination got a backup" : ""}.`;
    const last = data.lastSuccessAt ? ago(data.lastSuccessAt, data.timestamp) : null;
    const raw = data.problem?.raw ?? data.error;
    return {
        title: `${data.jobName} failed`,
        message,
        preheader: `${data.problem ? `${data.problem.title}.` : message}${last ? ` Last clean run ${last}.` : ""}`,
        fields: [
            { name: "Job", value: data.jobName, inline: true },
            ...(data.sourceName ? [{ name: "Source", value: data.sourceName, inline: true }] : []),
            ...(raw ? [{ name: "Error", value: raw, inline: false }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#ef4444",
        success: false,
        tone: "failure",
        icon: "circle-x",
        stats: [
            ...stat("Started", f.time(data.startedAt)),
            ...stat("Duration", data.duration !== undefined ? duration(data.duration) : undefined),
            ...stat("Trigger", startedBy(data.trigger)),
            ...stat("Failed in a row", data.failedInARow ? String(data.failedInARow) : undefined),
        ],
        problem: data.problem ?? (data.error ? { title: "The run stopped with an error", raw: data.error } : undefined),
        details: [
            { name: "Job", value: data.jobName },
            ...(source(data) ? [{ name: "Source", value: source(data)! }] : []),
            ...((data.destinations ?? []).length ? [{ name: "Destinations", value: data.destinations!.map((dest) => dest.name).join(", ") }] : []),
            ...(data.lastSuccessAt ? [{ name: "Last clean run", value: f.date(data.lastSuccessAt)! }] : []),
        ],
        actions: runActions(data),
        timestamp: data.timestamp,
    };
}
