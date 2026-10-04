import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ module: "notification-brand" });

/** What a notification says about the instance it comes from. */
export interface NotificationBrand {
    /** The name under Settings, General, or null while it has none. */
    instanceName: string | null;
    /** `BETTER_AUTH_URL` without its trailing slash, the address the buttons of a mail lead to. Null without one. */
    baseUrl: string | null;
    /** `system.timezone`, which every time in a notification uses. */
    timeZone: string;
}

export const DEFAULT_BRAND: NotificationBrand = { instanceName: null, baseUrl: null, timeZone: "UTC" };

/** The name, address and time zone of this instance. Never throws, a notification goes out without them. */
export async function loadNotificationBrand(): Promise<NotificationBrand> {
    const baseUrl = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, "") || null;
    try {
        const rows = await prisma.systemSetting.findMany({
            where: { key: { in: ["general.instanceName", "system.timezone"] } },
            select: { key: true, value: true },
        });
        const value = (key: string) => rows.find((row) => row.key === key)?.value?.trim() || null;
        return { instanceName: value("general.instanceName"), baseUrl, timeZone: value("system.timezone") ?? "UTC" };
    } catch (error) {
        log.warn("Could not read the name and time zone for a notification", {}, wrapError(error));
        return { ...DEFAULT_BRAND, baseUrl };
    }
}

/** `"DBackup · Production" <backup@example.com>` for a sender written without a name. */
export function senderWithName(from: string, brand: NotificationBrand): string {
    if (!from || from.includes("<")) return from;
    const name = brand.instanceName ? `DBackup · ${brand.instanceName}` : "DBackup";
    return `"${name.replace(/"/g, "'")}" <${from.trim()}>`;
}
