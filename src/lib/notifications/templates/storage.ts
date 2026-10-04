import type {
    AirGapSkippedData,
    NotificationPayload,
    StorageLimitWarningData,
    StorageMissingBackupData,
    StorageUsageSpikeData,
    TemplateOptions,
} from "../types";
import { action, ago, formatterFor, paths, size } from "./format";

/** The alerts of a destination, and a run that left out an air-gapped one. */

function openStorage(id: string | undefined) {
    return action("Open destination", id ? paths.storage(id) : undefined, "archive");
}

export function storageUsageSpikeTemplate(data: StorageUsageSpikeData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const change = `${data.changePercent > 0 ? "+" : ""}${data.changePercent.toFixed(1)}%`;
    const verb = data.changePercent > 0 ? "grew" : "shrank";
    return {
        title: `${data.storageName} ${verb} by ${Math.abs(data.changePercent).toFixed(1)}%`,
        message: `It went from ${size(data.previousSize)} to ${size(data.currentSize)} between two measurements.`,
        fields: [
            { name: "Storage", value: data.storageName, inline: true },
            { name: "Change", value: change, inline: true },
            { name: "Previous Size", value: size(data.previousSize), inline: true },
            { name: "Current Size", value: size(data.currentSize), inline: true },
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#f59e0b",
        success: false,
        badge: "Alert",
        tone: "warning",
        icon: "trending-up",
        stats: [
            { label: "Change", value: change },
            { label: "Before", value: size(data.previousSize) },
            { label: "Now", value: size(data.currentSize) },
            { label: "Measured", value: f.time(data.timestamp) ?? "" },
        ],
        details: [{ name: "Destination", value: data.storageName }],
        actions: openStorage(data.storageId),
        timestamp: data.timestamp,
    };
}

export function storageLimitWarningTemplate(data: StorageLimitWarningData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const percent = Math.round(data.usagePercent);
    const left = Math.max(0, data.limitSize - data.currentSize);
    const over = data.usagePercent >= 100;
    return {
        title: over ? `${data.storageName} is over its limit` : `${data.storageName} is nearly full`,
        message: `It holds ${size(data.currentSize)} of the ${size(data.limitSize)} its alert allows.`,
        preheader: `${data.storageName} is at ${percent}% of its limit, ${size(left)} left.`,
        fields: [
            { name: "Storage", value: data.storageName, inline: true },
            { name: "Usage", value: `${data.usagePercent.toFixed(1)}%`, inline: true },
            { name: "Current Size", value: size(data.currentSize), inline: true },
            { name: "Limit", value: size(data.limitSize), inline: true },
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#ef4444",
        success: false,
        badge: "Alert",
        tone: "warning",
        icon: "hard-drive",
        stats: [
            { label: "Used", value: size(data.currentSize) },
            { label: "Limit", value: size(data.limitSize) },
            { label: "Left", value: size(left) },
            { label: "Measured", value: f.time(data.timestamp) ?? "" },
        ],
        usage: { percent: Math.min(100, data.usagePercent), label: `${percent}% of the limit`, aside: "Alert from 90%" },
        details: [{ name: "Destination", value: data.storageName }],
        actions: openStorage(data.storageId),
        timestamp: data.timestamp,
    };
}

export function storageMissingBackupTemplate(data: StorageMissingBackupData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    return {
        title: `${data.storageName} got no new backup`,
        message: `Nothing new arrived there in ${data.hoursSinceLastBackup} hours, its alert allows ${data.thresholdHours}.`,
        fields: [
            { name: "Storage", value: data.storageName, inline: true },
            { name: "Hours Since Last Backup", value: `${data.hoursSinceLastBackup}h`, inline: true },
            { name: "Threshold", value: `${data.thresholdHours}h`, inline: true },
            ...(data.lastBackupAt ? [{ name: "Last Backup", value: f.date(data.lastBackupAt)!, inline: true }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#3b82f6",
        success: false,
        badge: "Alert",
        tone: "warning",
        icon: "clock-alert",
        stats: [
            { label: "Without a backup", value: `${data.hoursSinceLastBackup} h` },
            { label: "Alert after", value: `${data.thresholdHours} h` },
        ],
        details: [
            { name: "Destination", value: data.storageName },
            ...(data.lastBackupAt ? [{ name: "Last backup", value: f.date(data.lastBackupAt)! }] : []),
        ],
        actions: openStorage(data.storageId),
        timestamp: data.timestamp,
    };
}

export function airGapSkippedTemplate(data: AirGapSkippedData, options?: TemplateOptions): NotificationPayload {
    const f = formatterFor(options);
    const since = data.lastConnectedAt ? ago(data.lastConnectedAt, data.timestamp) : null;
    return {
        title: `${data.storageName} was skipped`,
        message: `${data.jobName} ran without '${data.storageName}', since it is air-gapped and not connected.${since ? ` It was last connected ${since}.` : ""}`,
        fields: [
            { name: "Destination", value: data.storageName, inline: true },
            { name: "Job", value: data.jobName, inline: true },
            ...(data.lastConnectedAt ? [{ name: "Last Connected", value: f.date(data.lastConnectedAt)!, inline: true }] : []),
            { name: "Time", value: f.date(data.timestamp) ?? data.timestamp, inline: true },
        ],
        color: "#6b7280", // gray, nothing is wrong
        success: true,
        badge: "Air-gapped",
        tone: "neutral",
        icon: "unplug",
        stats: [
            { label: "Run of", value: data.jobName },
            ...(since ? [{ label: "Last connected", value: since.replace(/ ago$/, "") }] : []),
        ],
        details: [
            { name: "Destination", value: data.storageName },
            ...(data.lastConnectedAt ? [{ name: "Last connected", value: f.date(data.lastConnectedAt)! }] : []),
        ],
        actions: [
            ...action("Open destination", data.storageId ? paths.connection("storage", data.storageId) : undefined, "archive"),
            ...action("Open job", data.jobId ? paths.job(data.jobId) : undefined, "calendar-clock"),
        ],
        timestamp: data.timestamp,
    };
}
