/**
 * The plain parts of the Settings page, General, Sign-in and Privacy: each read with its defaults
 * and saved as a whole, the way its save bar hands it over.
 */

import prisma from "@/lib/prisma";
import { isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ service: "SystemSettingsService" });

export interface GeneralSettings {
    /** Shown in the browser tab as "DBackup | name", empty for DBackup alone. */
    instanceName: string;
    timezone: string;
    maxConcurrentJobs: number;
    /** Minutes without progress before a run fails, 0 for never. */
    stuckTimeoutMinutes: number;
    checkForUpdates: boolean;
    showQuickSetup: boolean;
}

export interface SignInSettings {
    /** How long a session lasts, in seconds. */
    sessionDuration: number;
    passkeyLogin: boolean;
}

export interface PrivacySettings {
    includeActorInMetadata: boolean;
}

export const MAX_CONCURRENT_JOBS = 10;
export const DEFAULT_SESSION_DURATION = 604800;

const KEYS = {
    instanceName: "general.instanceName",
    timezone: "system.timezone",
    maxConcurrentJobs: "maxConcurrentJobs",
    checkForUpdates: "general.checkForUpdates",
    showQuickSetup: "general.showQuickSetup",
    sessionDuration: "auth.sessionDuration",
    // Stored the other way round, true turns the passkey button off.
    disablePasskeyLogin: "auth.disablePasskeyLogin",
    includeActor: "privacy.includeActorInMetadata",
} as const;

/** The stuck run watchdog lives in its own module, which pulls the queue in with it. */
const stuckTimeout = () => import("@/services/system/stuck-execution-service");

async function readAll(keys: string[]): Promise<Map<string, string>> {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    return new Map(rows.map((row) => [row.key, row.value]));
}

function upsert(key: string, value: string, description?: string) {
    return prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, ...(description ? { description } : {}) },
    });
}

/** A whole number from storage, or the fallback when it is missing or broken. */
function whole(value: string | undefined, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : fallback;
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
    const { STUCK_TIMEOUT_SETTING, DEFAULT_STUCK_TIMEOUT_MINUTES } = await stuckTimeout();
    const stored = await readAll([...Object.values(KEYS), STUCK_TIMEOUT_SETTING]);
    return {
        instanceName: stored.get(KEYS.instanceName) ?? "",
        timezone: stored.get(KEYS.timezone) || "UTC",
        maxConcurrentJobs: whole(stored.get(KEYS.maxConcurrentJobs), 1, 1, MAX_CONCURRENT_JOBS),
        stuckTimeoutMinutes: whole(stored.get(STUCK_TIMEOUT_SETTING), DEFAULT_STUCK_TIMEOUT_MINUTES, 0),
        checkForUpdates: stored.get(KEYS.checkForUpdates) !== "false",
        showQuickSetup: stored.get(KEYS.showQuickSetup) === "true",
    };
}

/**
 * Saves the General part. The scheduler starts over when the time zone changes, or a setting
 * that a system task follows, like Look for new versions.
 */
export async function saveGeneralSettings(next: GeneralSettings): Promise<void> {
    const { STUCK_TIMEOUT_SETTING } = await stuckTimeout();
    const before = await getGeneralSettings();
    await prisma.$transaction([
        upsert(KEYS.instanceName, next.instanceName.trim(), "Custom instance name shown in the browser tab title"),
        upsert(KEYS.timezone, next.timezone, "System-wide timezone for scheduler"),
        upsert(KEYS.maxConcurrentJobs, String(next.maxConcurrentJobs)),
        upsert(STUCK_TIMEOUT_SETTING, String(next.stuckTimeoutMinutes)),
        upsert(KEYS.checkForUpdates, String(next.checkForUpdates)),
        upsert(KEYS.showQuickSetup, String(next.showQuickSetup)),
    ]);

    const followed = before.checkForUpdates !== next.checkForUpdates || (before.stuckTimeoutMinutes === 0) !== (next.stuckTimeoutMinutes === 0);
    if (before.timezone !== next.timezone || followed) {
        const { scheduler } = await import("@/lib/server/scheduler");
        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after the general settings changed", {}, wrapError(e)));
    }
}

export async function getSignInSettings(): Promise<SignInSettings> {
    const stored = await readAll([KEYS.sessionDuration, KEYS.disablePasskeyLogin]);
    return {
        sessionDuration: whole(stored.get(KEYS.sessionDuration), DEFAULT_SESSION_DURATION, 1),
        passkeyLogin: stored.get(KEYS.disablePasskeyLogin) !== "true",
    };
}

/**
 * Whether turning the passkey button off would leave nobody a way to sign in: the container
 * turned passwords off with DISABLE_EMAIL_LOGIN, and no sign-in provider is on.
 */
export async function passkeyIsLastWayIn(): Promise<boolean> {
    if (!isEmailLoginDisabled()) return false;
    return (await prisma.ssoProvider.count({ where: { enabled: true } })) === 0;
}

export async function saveSignInSettings(next: SignInSettings): Promise<void> {
    const before = await getSignInSettings();
    if (before.passkeyLogin && !next.passkeyLogin && (await passkeyIsLastWayIn())) {
        throw new ValidationError(
            "DISABLE_EMAIL_LOGIN turns passwords off and no sign-in provider is on, so a passkey is the only way left to sign in.",
            { field: "passkeyLogin" }
        );
    }
    await prisma.$transaction([
        upsert(KEYS.sessionDuration, String(next.sessionDuration)),
        upsert(KEYS.disablePasskeyLogin, String(!next.passkeyLogin)),
    ]);
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
    const stored = await readAll([KEYS.includeActor]);
    return { includeActorInMetadata: stored.get(KEYS.includeActor) !== "false" };
}

export async function savePrivacySettings(next: PrivacySettings): Promise<void> {
    await upsert(KEYS.includeActor, String(next.includeActorInMetadata));
}
