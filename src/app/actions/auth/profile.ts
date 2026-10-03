"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUserWithGroup, hasPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { diffFields } from "@/lib/core/audit-diff";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { DATE_FORMAT_VALUES, TIME_FORMAT_VALUES, isKnownTimezone } from "@/lib/core/profile-formats";
import { TaskColorsSchema, type TaskColors } from "@/lib/core/task-colors";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { invalid, type SaveResult } from "@/lib/settings/save-part";
import { auditService } from "@/services/audit-service";
import { setTaskColors } from "@/services/user/preference-service";
import { userService } from "@/services/user/user-service";

const log = logger.child({ action: "profile" });

const AccountSchema = z.object({
    name: z.string().trim().min(2, "A name has at least 2 characters.").max(100, "A name has at most 100 characters."),
    email: z.string().trim().toLowerCase().email("That is no email address."),
});

const ACCOUNT_FIELDS = { name: { label: "Name" }, email: { label: "Email" } };

/**
 * Saves the name and the email of the signed-in user. Each needs its permission of the own profile
 * once it changes, so a group without them keeps its name and email.
 *
 * @no-permission-required - Self-service: only the own account, the permission of each changed field is checked below.
 */
export async function saveProfileAccountAction(input: { name: string; email: string }): Promise<SaveResult> {
    const user = await getCurrentUserWithGroup();
    if (!user) return { success: false, error: "Unauthorized" };
    const parsed = AccountSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const { name, email } = parsed.data;

    if (name !== user.name && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_NAME))) {
        return { success: false, error: "Your group may not change your name.", field: "name" };
    }
    if (email !== user.email && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_EMAIL))) {
        return { success: false, error: "Your group may not change your email.", field: "email" };
    }

    try {
        await userService.updateUser(user.id, { name, email });
    } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return { success: false, error: "Another account signs in with this email.", field: "email" };
        }
        log.error("Saving the own account failed", { userId: user.id }, wrapError(error));
        return { success: false, error: "The account could not be saved." };
    }

    const changes = diffFields({ name: user.name, email: user.email }, { name, email }, ACCOUNT_FIELDS);
    if (changes.length > 0) await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { name, changes }, user.id);
    revalidatePath("/dashboard", "layout");
    return { success: true };
}

const DatesSchema = z.object({
    timezone: z.string().refine(isKnownTimezone, "That time zone is unknown."),
    dateFormat: z.string().refine((value) => DATE_FORMAT_VALUES.includes(value), "Pick one of the date formats."),
    timeFormat: z.string().refine((value) => TIME_FORMAT_VALUES.includes(value), "Pick one of the time formats."),
});

const DATE_FIELDS = { timezone: { label: "Time zone" }, dateFormat: { label: "Date" }, timeFormat: { label: "Time" } };

/**
 * Saves how dates and times read for the signed-in user: the time zone, empty for the one of the
 * browser, and the formats.
 *
 * @no-permission-required - Self-service: how the own dashboard shows dates, for the signed-in user alone.
 */
export async function saveProfileDatesAction(input: { timezone: string; dateFormat: string; timeFormat: string }): Promise<SaveResult> {
    const user = await getCurrentUserWithGroup();
    if (!user) return { success: false, error: "Unauthorized" };
    const parsed = DatesSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);

    try {
        await userService.updateUser(user.id, parsed.data);
    } catch (error: unknown) {
        log.error("Saving the own dates failed", { userId: user.id }, wrapError(error));
        return { success: false, error: "The dates could not be saved." };
    }

    const changes = diffFields(
        { timezone: user.timezone || "This browser", dateFormat: user.dateFormat, timeFormat: user.timeFormat },
        { ...parsed.data, timezone: parsed.data.timezone || "This browser" },
        DATE_FIELDS
    );
    if (changes.length > 0) await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { name: user.name, changes }, user.id);
    revalidatePath("/dashboard", "layout");
    return { success: true };
}

/**
 * Saves the colors of the tasks the signed-in user picked. They color the app for them alone.
 *
 * @no-permission-required - Self-service: a display preference of the signed-in user, like the table defaults.
 */
export async function saveTaskColorsAction(colors: TaskColors): Promise<SaveResult> {
    const user = await getCurrentUserWithGroup();
    if (!user) return { success: false, error: "Unauthorized" };
    const parsed = TaskColorsSchema.safeParse(colors);
    if (!parsed.success) return invalid(parsed.error.issues);

    try {
        await setTaskColors(user.id, parsed.data);
    } catch (error: unknown) {
        log.error("Saving the task colors failed", { userId: user.id }, wrapError(error));
        return { success: false, error: "The colors could not be saved." };
    }
    // The dashboard layout puts them on every page.
    revalidatePath("/dashboard", "layout");
    return { success: true };
}
