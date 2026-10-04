import type { ConfigBackupData, NotificationPayload, RestoreResultData, TemplateOptions } from "../types";
import { action, duration, formatterFor, paths, size } from "./format";
import { problemOf, timeField } from "./problem";

/** Restores, and the backup of the configuration. */

function restoreFields(data: RestoreResultData) {
    return [
        ...(data.sourceName ? [{ name: "Source", value: data.sourceName, inline: true }] : []),
        ...(data.databaseType ? [{ name: "Database Type", value: data.databaseType.toUpperCase(), inline: true }] : []),
        ...(data.targetDatabase ? [{ name: "Target DB", value: data.targetDatabase, inline: true }] : []),
        ...(data.storageName ? [{ name: "Storage", value: data.storageName, inline: true }] : []),
        ...(data.backupFile ? [{ name: "Backup File", value: data.backupFile, inline: false }] : []),
    ];
}

function restoreDetails(data: RestoreResultData) {
    return [
        ...(data.targetDatabase ? [{ name: "Database", value: data.targetDatabase }] : []),
        ...(data.sourceName ? [{ name: "Server", value: data.sourceName }] : []),
        ...(data.backupFile ? [{ name: "Backup", value: data.backupFile }] : []),
        ...(data.storageName ? [{ name: "From", value: data.storageName }] : []),
    ];
}

export function restoreCompleteTemplate(data: RestoreResultData, options?: TemplateOptions): NotificationPayload {
    const target = data.targetDatabase ?? data.sourceName;
    return {
        title: target ? `${target} was restored` : "A restore finished",
        message: `The restore finished${data.targetDatabase ? `, ${data.targetDatabase} holds the data of the backup now` : ""}.`,
        fields: [
            ...restoreFields(data),
            ...(data.size !== undefined ? [{ name: "Size", value: size(data.size), inline: true }] : []),
            ...(data.duration !== undefined ? [{ name: "Duration", value: duration(data.duration), inline: true }] : []),
            timeField(data.timestamp, options),
        ],
        color: "#22c55e",
        success: true,
        tone: "success",
        icon: "circle-check",
        stats: [
            ...(data.duration !== undefined ? [{ label: "Duration", value: duration(data.duration) }] : []),
            ...(data.size !== undefined ? [{ label: "Size", value: size(data.size) }] : []),
            ...(data.databaseType ? [{ label: "Type", value: data.databaseType.toUpperCase() }] : []),
            { label: "Finished", value: formatterFor(options).time(data.timestamp) ?? "" },
        ],
        details: restoreDetails(data),
        actions: action("Open run", data.executionId ? paths.run(data.executionId) : undefined, "history"),
        timestamp: data.timestamp,
    };
}

export function restoreFailureTemplate(data: RestoreResultData, options?: TemplateOptions): NotificationPayload {
    const target = data.targetDatabase ?? data.sourceName;
    return {
        title: target ? `The restore of ${target} failed` : "A restore failed",
        message: "The restore stopped with an error.",
        fields: [
            ...restoreFields(data).filter((field) => field.name !== "Storage"),
            ...(data.error ? [{ name: "Error", value: data.error, inline: false }] : []),
            ...(data.duration !== undefined ? [{ name: "Duration", value: duration(data.duration), inline: true }] : []),
            timeField(data.timestamp, options),
        ],
        color: "#ef4444",
        success: false,
        tone: "failure",
        icon: "circle-x",
        stats: [
            ...(data.duration !== undefined ? [{ label: "Duration", value: duration(data.duration) }] : []),
            ...(data.databaseType ? [{ label: "Type", value: data.databaseType.toUpperCase() }] : []),
            { label: "Stopped", value: formatterFor(options).time(data.timestamp) ?? "" },
        ],
        problem: data.error ? problemOf(data.error, data.sourceName ?? null, "Restoring", data.sourceName ? "source" : null) : undefined,
        details: restoreDetails(data),
        actions: action("Open run", data.executionId ? paths.run(data.executionId) : undefined, "history"),
        timestamp: data.timestamp,
    };
}

export function configBackupTemplate(data: ConfigBackupData, options?: TemplateOptions): NotificationPayload {
    return {
        title: "The configuration was backed up",
        message: `A copy of the configuration was saved${data.encrypted ? " and encrypted" : ""}.`,
        fields: [
            ...(data.fileName ? [{ name: "File", value: data.fileName, inline: true }] : []),
            ...(data.size !== undefined ? [{ name: "Size", value: size(data.size), inline: true }] : []),
            { name: "Encrypted", value: data.encrypted ? "Yes" : "No", inline: true },
            timeField(data.timestamp, options),
        ],
        color: "#8b5cf6",
        success: true,
        tone: "success",
        icon: "file-cog",
        stats: [
            ...(data.size !== undefined ? [{ label: "Size", value: size(data.size) }] : []),
            { label: "Encrypted", value: data.encrypted ? "Yes" : "No" },
            { label: "Saved", value: formatterFor(options).time(data.timestamp) ?? "" },
        ],
        details: data.fileName ? [{ name: "File", value: data.fileName }] : [],
        actions: action("Open the configuration backup", "/dashboard/settings?part=config-backup", "settings"),
        timestamp: data.timestamp,
    };
}

