"use server"

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

const settingsSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
});

export async function updateSystemSettings(data: z.infer<typeof settingsSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = settingsSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.errors[0].message };
    }

    try {
        await prisma.systemSetting.upsert({
            where: { key: "maxConcurrentJobs" },
            update: { value: String(result.data.maxConcurrentJobs) },
            create: { key: "maxConcurrentJobs", value: String(result.data.maxConcurrentJobs) },
        });

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
        console.error("Failed to update system settings:", error);
        return { success: false, error: "Failed to update settings" };
    }
}
