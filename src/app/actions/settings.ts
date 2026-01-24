"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

const settingsSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
    disablePasskeyLogin: z.boolean().optional(),
});

export async function updateSystemSettings(data: z.infer<typeof settingsSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = settingsSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }

    try {
        await prisma.systemSetting.upsert({
            where: { key: "maxConcurrentJobs" },
            update: { value: String(result.data.maxConcurrentJobs) },
            create: { key: "maxConcurrentJobs", value: String(result.data.maxConcurrentJobs) },
        });

        // Passkey Login Setting (default false/enabled, stored as true if disabled)
        if (result.data.disablePasskeyLogin !== undefined) {
             await prisma.systemSetting.upsert({
                where: { key: "auth.disablePasskeyLogin" },
                update: { value: String(result.data.disablePasskeyLogin) },
                create: { key: "auth.disablePasskeyLogin", value: String(result.data.disablePasskeyLogin) },
            });
        }

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
        console.error("Failed to update system settings:", error);
        return { success: false, error: "Failed to update settings" };
    }
}
