import prisma from "@/lib/prisma";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { DATA_RETENTION_SETTINGS, formatRetentionDays, type DataRetentionId } from "@/lib/core/data-retention";
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS } from "@/lib/rate-limit";
import { LEVEL_NAMES } from "@/lib/auth/password-policy";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
import type { CertificateInfo } from "@/services/system/certificate-service";

/**
 * The settings as the audit log compares them: each part of the Settings page read the way the page
 * shows it, defaults included, so an entry holds what changed from and to in words a person reads.
 */

/** The parts of the settings, as an entry names them in `area`. */
export const SETTINGS_AREAS = {
    GENERAL: "General",
    SIGN_IN: "Sign-in",
    PASSWORDS: "Passwords",
    DATA_RETENTION: "Data retention",
    NOTIFICATIONS: "Notifications",
    RATE_LIMITS: "Rate limits",
    PRIVACY: "Privacy",
    CERTIFICATE: "Certificate",
    INTEGRITY: "Integrity checks",
    CONFIG_BACKUP: "Config backup",
    STORAGE_ALERTS: "Storage alerts",
} as const;

export interface SettingsSnapshot {
    fields: Record<string, AuditField>;
    values: Record<string, AuditValue>;
}

/** What changed between two readings of the same settings. */
export function settingsChanges(before: SettingsSnapshot, after: SettingsSnapshot): AuditChange[] {
    return diffFields(before.values, after.values, { ...before.fields, ...after.fields });
}

/** One stored setting as the audit log names and shows it. */
interface StoredSetting {
    key: string;
    label: string;
    /** What the settings page assumes while nothing is stored. */
    fallback: string;
    show?: (value: string) => AuditValue;
}

const on = (value: string) => value === "true";
/** "1 day", "30 days", or what 0 means, like "No limit". */
const count = (one: string, many: string, none: string) => (value: string) => {
    const amount = Number(value);
    return amount > 0 ? `${value} ${amount === 1 ? one : many}` : none;
};

/** "30 minutes", "6 hours", "Never" for the stuck job timeout. */
function minutesText(value: string): string {
    const minutes = Number(value);
    if (minutes === 0) return "Never";
    if (minutes % 60 !== 0) return `${minutes} minutes`;
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** "8 hours", "7 days" for the session duration, which is stored in seconds. */
function secondsText(value: string): string {
    const seconds = Number(value);
    if (seconds % 86400 === 0) return seconds === 86400 ? "1 day" : `${seconds / 86400} days`;
    if (seconds % 3600 === 0) return seconds === 3600 ? "1 hour" : `${seconds / 3600} hours`;
    return `${seconds} seconds`;
}

const seconds = (value: string) => `${value} seconds`;
const requests = (value: string) => `${value} ${value === "1" ? "request" : "requests"}`;

async function readStored(settings: readonly StoredSetting[]): Promise<SettingsSnapshot> {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: settings.map((setting) => setting.key) } }, select: { key: true, value: true } });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const fields: Record<string, AuditField> = {};
    const values: Record<string, AuditValue> = {};
    for (const setting of settings) {
        const value = stored.get(setting.key) ?? setting.fallback;
        fields[setting.key] = { label: setting.label };
        values[setting.key] = setting.show ? setting.show(value) : value;
    }
    return { fields, values };
}

const general = (stuckTimeoutKey: string, stuckTimeoutDefault: number): StoredSetting[] => [
    { key: "general.instanceName", label: "Name", fallback: "" },
    { key: "system.timezone", label: "Time zone", fallback: "UTC" },
    { key: "maxConcurrentJobs", label: "Runs at the same time", fallback: "1" },
    { key: stuckTimeoutKey, label: "Fail a run that stops reporting after", fallback: String(stuckTimeoutDefault), show: minutesText },
    { key: "general.checkForUpdates", label: "Look for new versions", fallback: "true", show: on },
    { key: "general.showQuickSetup", label: "Show Quick Setup in the sidebar", fallback: "false", show: on },
];

const SIGN_IN: StoredSetting[] = [
    { key: "auth.sessionDuration", label: "Sessions last", fallback: "604800", show: secondsText },
    // Stored as a switch that turns it off, shown the way round that on means on.
    { key: "auth.disablePasskeyLogin", label: "Sign in with a passkey", fallback: "false", show: (value) => !on(value) },
    { key: "signin.loginLook", label: "Login page", fallback: "logos", show: (value) => (value === "image" ? "Your own image" : "DBackup logos") },
];

const PRIVACY: StoredSetting[] = [
    { key: "privacy.includeActorInMetadata", label: "Name who started a backup in its metadata", fallback: "true", show: on },
];

const INTEGRITY: StoredSetting[] = [
    { key: "integrity.scanMode", label: "What it checks", fallback: "jobs", show: (value) => (value === "destinations" ? "Every file" : "Backups of jobs") },
    { key: "integrity.skipPassed", label: "Skip backups that passed", fallback: "false", show: on },
    { key: "integrity.maxAgeDays", label: "Only backups newer than", fallback: "0", show: count("day", "days", "No limit") },
    { key: "integrity.maxFileSizeMb", label: "Skip files larger than", fallback: "0", show: count("MB", "MB", "No limit") },
];

const RATE_LIMITS: StoredSetting[] = [
    { key: RATE_LIMIT_KEYS.authPoints, label: "Sign-ins", fallback: String(RATE_LIMIT_DEFAULTS.auth.points), show: requests },
    { key: RATE_LIMIT_KEYS.authDuration, label: "Sign-ins window", fallback: String(RATE_LIMIT_DEFAULTS.auth.duration), show: seconds },
    { key: RATE_LIMIT_KEYS.apiPoints, label: "Reads through the API", fallback: String(RATE_LIMIT_DEFAULTS.api.points), show: requests },
    { key: RATE_LIMIT_KEYS.apiDuration, label: "Reads through the API window", fallback: String(RATE_LIMIT_DEFAULTS.api.duration), show: seconds },
    { key: RATE_LIMIT_KEYS.mutationPoints, label: "Changes through the API", fallback: String(RATE_LIMIT_DEFAULTS.mutation.points), show: requests },
    { key: RATE_LIMIT_KEYS.mutationDuration, label: "Changes through the API window", fallback: String(RATE_LIMIT_DEFAULTS.mutation.duration), show: seconds },
];

const CONFIG_DESTINATION = "config.backup.storageId";
const CONFIG_KEY = "config.backup.profileId";

const CONFIG_BACKUP: StoredSetting[] = [
    { key: "config.backup.enabled", label: "Back up the configuration", fallback: "false", show: on },
    { key: CONFIG_DESTINATION, label: "Destination", fallback: "" },
    { key: CONFIG_KEY, label: "Encryption key", fallback: "" },
    { key: "config.backup.schedule", label: "Schedule", fallback: "0 3 * * *" },
    { key: "config.backup.includeStatistics", label: "Include the history", fallback: "true", show: on },
    { key: "config.backup.retention", label: "Keeps", fallback: "10" },
];

/** The General part. The stuck run watchdog is imported only here, it pulls the queue in with it. */
export async function generalSettings(): Promise<SettingsSnapshot> {
    const { STUCK_TIMEOUT_SETTING, DEFAULT_STUCK_TIMEOUT_MINUTES } = await import("@/services/system/stuck-execution-service");
    return readStored(general(STUCK_TIMEOUT_SETTING, DEFAULT_STUCK_TIMEOUT_MINUTES));
}

const PASSWORD_FIELDS: Record<string, AuditField> = {
    level: { label: "Strength" },
    minLength: { label: "Minimum length" },
    upper: { label: "Upper case letters" },
    lower: { label: "Lower case letters" },
    digits: { label: "Numbers" },
    special: { label: "Special characters" },
    notName: { label: "Not the name or the email" },
};

/** The rules of new passwords as they apply, the level by its name. */
export async function passwordSettings(): Promise<SettingsSnapshot> {
    const policy = await getPasswordPolicy();
    return {
        fields: PASSWORD_FIELDS,
        values: {
            level: LEVEL_NAMES[policy.level],
            minLength: `${policy.minLength} characters`,
            upper: policy.upper,
            lower: policy.lower,
            digits: policy.digits,
            special: policy.special > 0 ? `At least ${policy.special}` : false,
            notName: policy.notName,
        },
    };
}

export const signInSettings = () => readStored(SIGN_IN);
export const privacySettings = () => readStored(PRIVACY);
export const integritySettings = () => readStored(INTEGRITY);
export const rateLimitSettings = () => readStored(RATE_LIMITS);

/** The config backup settings, with the destination and the key by their names. */
export async function configBackupSettings(): Promise<SettingsSnapshot> {
    const snapshot = await readStored(CONFIG_BACKUP);
    const id = (key: string) => (typeof snapshot.values[key] === "string" && snapshot.values[key] ? (snapshot.values[key] as string) : null);
    const destinationId = id(CONFIG_DESTINATION);
    const keyId = id(CONFIG_KEY);
    const [destination, key] = await Promise.all([
        destinationId ? prisma.adapterConfig.findUnique({ where: { id: destinationId }, select: { name: true } }) : null,
        keyId ? prisma.encryptionProfile.findUnique({ where: { id: keyId }, select: { name: true } }) : null,
    ]);
    // A destination or key that is gone keeps its id, which still tells two apart.
    snapshot.values[CONFIG_DESTINATION] = destination?.name ?? destinationId;
    snapshot.values[CONFIG_KEY] = key?.name ?? keyId;
    return snapshot;
}

/** What changed between two readings of the retention periods, in the words of the Data retention part. */
export function retentionChanges(before: Record<DataRetentionId, number>, after: Record<DataRetentionId, number>): AuditChange[] {
    const fields = Object.fromEntries(DATA_RETENTION_SETTINGS.map((setting) => [setting.id, { label: setting.label }]));
    const shown = (values: Record<DataRetentionId, number>) =>
        Object.fromEntries(DATA_RETENTION_SETTINGS.map((setting) => [setting.id, formatRetentionDays(values[setting.id])]));
    return diffFields(shown(before), shown(after), fields);
}

const CERTIFICATE_FIELDS: Record<string, AuditField> = {
    subject: { label: "Subject" },
    issuer: { label: "Issuer" },
    validTo: { label: "Valid until" },
    fingerprint: { label: "Fingerprint" },
};

/** The day a certificate runs out, as a date without a time. */
function day(value: string): string | null {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/** The TLS certificate as the audit log compares it: what it says about itself, never its key. */
export function certificateSnapshot(info: CertificateInfo): SettingsSnapshot {
    return {
        fields: CERTIFICATE_FIELDS,
        values: info.exists ? { subject: info.subject, issuer: info.issuer, validTo: day(info.validTo), fingerprint: info.fingerprint } : {},
    };
}

/** A new certificate always comes with a new private key, which is written as changed and nothing more. */
export function certificateChanges(before: SettingsSnapshot, after: SettingsSnapshot): AuditChange[] {
    return [...settingsChanges(before, after), { field: "Private key", from: null, to: null, secret: true }];
}
