"use server"

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isValidTimezone } from "@/lib/utils";
import { MAX_CONCURRENT_JOBS, saveGeneralSettings, saveSignInSettings } from "@/services/system/system-settings-service";
import { generalSettings, signInSettings, SETTINGS_AREAS } from "@/services/system/settings-audit";
import { invalid, savePart, type SaveResult } from "@/lib/settings/save-part";

const generalSchema = z.object({
    instanceName: z.string().trim().max(50),
    timezone: z.string().refine(isValidTimezone, { message: "Invalid IANA timezone" }),
    maxConcurrentJobs: z.coerce.number().int().min(1).max(MAX_CONCURRENT_JOBS),
    // 0 disables the watchdog. The upper bound is a week, past which a run that reports no
    // progress is not worth waiting for under any configuration.
    stuckTimeoutMinutes: z.coerce.number().int().min(0).max(10080),
    checkForUpdates: z.boolean(),
    showQuickSetup: z.boolean(),
});

const signInSchema = z.object({
    sessionDuration: z.coerce.number().int().min(3600).max(7776000), // 1h to 90d in seconds
    passkeyLogin: z.boolean(),
    loginLook: z.enum(["logos", "image"]),
});

export async function saveGeneralSettingsAction(input: z.infer<typeof generalSchema>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = generalSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    return savePart(user.id, SETTINGS_AREAS.GENERAL, generalSettings, () => saveGeneralSettings(parsed.data));
}

export async function saveSignInSettingsAction(input: z.infer<typeof signInSchema>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = signInSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    return savePart(user.id, SETTINGS_AREAS.SIGN_IN, signInSettings, () => saveSignInSettings(parsed.data));
}
