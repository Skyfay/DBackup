import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { formatBytes } from "@/lib/utils";
import type { StorageAlertConfig } from "./storage-alert-service";

/** The alerts of a destination as the audit log compares them, in the words of the Alerts dialog. */

const FIELDS: Record<keyof StorageAlertConfig, AuditField> = {
    usageSpikeEnabled: { label: "Usage spike" },
    usageSpikeThresholdPercent: { label: "Usage spike threshold" },
    storageLimitEnabled: { label: "Storage limit" },
    storageLimitBytes: { label: "Storage limit size" },
    missingBackupEnabled: { label: "Missing backup" },
    missingBackupHours: { label: "Missing backup after" },
};

function shown(config: StorageAlertConfig): Record<keyof StorageAlertConfig, AuditValue> {
    return {
        usageSpikeEnabled: config.usageSpikeEnabled,
        usageSpikeThresholdPercent: `${config.usageSpikeThresholdPercent} %`,
        storageLimitEnabled: config.storageLimitEnabled,
        storageLimitBytes: formatBytes(config.storageLimitBytes),
        missingBackupEnabled: config.missingBackupEnabled,
        missingBackupHours: `${config.missingBackupHours} hours`,
    };
}

/** What a change of the alerts of one destination changed. */
export function alertChanges(before: StorageAlertConfig, after: StorageAlertConfig): AuditChange[] {
    return diffFields(shown(before), shown(after), FIELDS);
}
