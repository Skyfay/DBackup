import type {
    ConnectionOfflineData,
    ConnectionOnlineData,
    DbVersionChangedData,
    IntegrityCheckFailureData,
    NotificationPayload,
    SystemErrorData,
    TemplateOptions,
    UpdateAvailableData,
} from "../types";
import { action, formatterFor, paths, plural } from "./format";
import { problemOf, timeField } from "./problem";

/** System tasks, updates and the health of the connections. */

export function systemErrorTemplate(data: SystemErrorData, options?: TemplateOptions): NotificationPayload {
    const raw = data.details ? `${data.error}\n${data.details}` : data.error;
    return {
        title: `${data.component} failed`,
        message: `A system task stopped with an error: ${data.error}`,
        fields: [
            { name: "Component", value: data.component, inline: true },
            { name: "Error", value: data.error, inline: false },
            ...(data.details ? [{ name: "Details", value: data.details, inline: false }] : []),
            timeField(data.timestamp, options),
        ],
        color: "#ef4444",
        success: false,
        tone: "failure",
        icon: "circle-x",
        stats: [{ label: "Task", value: data.component }, { label: "Stopped", value: formatterFor(options).time(data.timestamp) ?? "" }],
        problem: problemOf(raw, null, data.component, null),
        details: [],
        actions: action("Open system tasks", "/dashboard/settings?part=tasks", "settings"),
        timestamp: data.timestamp,
    };
}

export function updateAvailableTemplate(data: UpdateAvailableData, options?: TemplateOptions): NotificationPayload {
    return {
        title: `DBackup ${data.latestVersion} is out`,
        message: `You run ${data.currentVersion}. The release notes say what changed and how to update.`,
        fields: [
            { name: "Latest Version", value: data.latestVersion, inline: true },
            { name: "Current Version", value: data.currentVersion, inline: true },
            ...(data.releaseUrl ? [{ name: "Release Notes", value: data.releaseUrl, inline: false }] : []),
            timeField(data.timestamp, options),
        ],
        color: "#3b82f6",
        success: true,
        badge: "Update",
        tone: "neutral",
        icon: "circle-arrow-up",
        stats: [{ label: "You run", value: data.currentVersion }, { label: "New", value: data.latestVersion }],
        details: [],
        actions: action("Release notes", data.releaseUrl, "external-link"),
        timestamp: data.timestamp,
    };
}

export function connectionOfflineTemplate(data: ConnectionOfflineData, options?: TemplateOptions): NotificationPayload {
    const label = data.adapterType === "database" ? "Source" : "Destination";
    return {
        title: `${data.adapterName} is offline`,
        message: `It missed ${data.consecutiveFailures} health checks in a row.`,
        fields: [
            { name: label, value: data.adapterName, inline: true },
            { name: "Type", value: data.adapterType, inline: true },
            { name: "Failed Checks", value: String(data.consecutiveFailures), inline: true },
            ...(data.lastError ? [{ name: "Last Error", value: data.lastError, inline: false }] : []),
            timeField(data.timestamp, options),
        ],
        color: "#ef4444",
        success: false,
        badge: "Offline",
        tone: "failure",
        icon: "unplug",
        stats: [
            { label: "Missed checks", value: String(data.consecutiveFailures) },
            { label: "Kind", value: label },
            { label: "Since", value: formatterFor(options).time(data.timestamp) ?? "" },
        ],
        problem: data.lastError
            ? problemOf(data.lastError, data.adapterName, "Health check", data.adapterType === "database" ? "source" : "destination", `Health check · ${formatterFor(options).clock(data.timestamp)}`)
            : undefined,
        details: [{ name: label, value: data.adapterName }],
        actions: action(`Open ${label.toLowerCase()}`, data.configId ? paths.connection(data.adapterType, data.configId) : undefined, "database"),
        timestamp: data.timestamp,
    };
}

export function connectionOnlineTemplate(data: ConnectionOnlineData, options?: TemplateOptions): NotificationPayload {
    const label = data.adapterType === "database" ? "Source" : "Destination";
    return {
        title: `${data.adapterName} is back`,
        message: `It answers its health checks again.${data.downtime ? ` It was offline for ${data.downtime}.` : ""}`,
        fields: [
            { name: label, value: data.adapterName, inline: true },
            { name: "Type", value: data.adapterType, inline: true },
            ...(data.downtime ? [{ name: "Downtime", value: data.downtime, inline: true }] : []),
            timeField(data.timestamp, options),
        ],
        color: "#22c55e",
        success: true,
        badge: "Recovered",
        tone: "success",
        icon: "plug",
        stats: [
            ...(data.downtime ? [{ label: "Offline for", value: data.downtime }] : []),
            { label: "Kind", value: label },
            { label: "Back at", value: formatterFor(options).time(data.timestamp) ?? "" },
        ],
        details: [{ name: label, value: data.adapterName }],
        actions: action(`Open ${label.toLowerCase()}`, data.configId ? paths.connection(data.adapterType, data.configId) : undefined, "database"),
        timestamp: data.timestamp,
    };
}

export function dbVersionChangedTemplate(data: DbVersionChangedData, options?: TemplateOptions): NotificationPayload {
    const from = data.previousVersion ?? "unknown";
    const down = data.isDowngrade;
    return {
        title: `${data.sourceName} was ${down ? "downgraded" : "upgraded"}`,
        message: `It went from ${from} to ${data.newVersion}.${down ? " A backup of the newer version may not restore onto it." : ""}`,
        fields: [
            { name: "Source", value: data.sourceName, inline: true },
            { name: "Adapter", value: data.adapterId, inline: true },
            { name: "Previous Version", value: from, inline: true },
            { name: "New Version", value: data.newVersion, inline: true },
            ...(data.edition ? [{ name: "Edition", value: data.edition, inline: true }] : []),
            timeField(data.timestamp, options),
        ],
        color: down ? "#f59e0b" : "#3b82f6",
        success: !down,
        badge: down ? "Downgrade" : "Upgrade",
        tone: down ? "warning" : "neutral",
        icon: down ? "triangle-alert" : "circle-arrow-up",
        stats: [
            { label: "Before", value: from },
            { label: "Now", value: data.newVersion },
            ...(data.edition ? [{ label: "Edition", value: data.edition }] : []),
        ],
        details: [{ name: "Source", value: data.sourceName }],
        actions: action("Open source", paths.connection("database", data.sourceId), "database"),
        timestamp: data.timestamp,
    };
}

export function integrityCheckFailureTemplate(data: IntegrityCheckFailureData): NotificationPayload {
    const shown = data.errors.slice(0, 5);
    const more = data.errors.length > 5 ? ` (+${data.errors.length - 5} more)` : "";
    return {
        title: `${plural(data.failed, "backup")} failed the integrity check`,
        message: `${data.failed} of ${plural(data.totalFiles, "file")} no longer match the checksum saved with them.`,
        fields: [
            { name: "Total Checked", value: String(data.totalFiles), inline: true },
            { name: "Failed", value: String(data.failed), inline: true },
            { name: "Passed", value: String(data.passed), inline: true },
            { name: "Trigger", value: data.triggerType, inline: true },
            ...(data.errors.length > 0 ? [{ name: "Corrupted Files", value: shown.map((entry) => entry.file).join(", ") + more, inline: false }] : []),
        ],
        color: "#ef4444",
        success: false,
        badge: "Alert",
        tone: "failure",
        icon: "shield-alert",
        stats: [
            { label: "Checked", value: String(data.totalFiles) },
            { label: "Failed", value: String(data.failed) },
            { label: "Passed", value: String(data.passed) },
            { label: "Skipped", value: String(data.skipped) },
        ],
        problem: data.errors.length > 0
            ? {
                title: "These files differ from what was written",
                help: "Restore from another copy, or run the job again for a fresh backup.",
                raw: shown.map((entry) => `${entry.destination}: ${entry.file}`).join("\n") + more,
            }
            : undefined,
        details: [{ name: "Started", value: data.triggerType === "Scheduler" ? "By schedule" : data.triggerType === "Api" ? "Through the API" : "By hand" }],
        actions: action("Open backups", "/dashboard/backups", "archive"),
    };
}
