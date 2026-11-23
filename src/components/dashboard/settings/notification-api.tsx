"use client";

import { createContext, useContext } from "react";
import { saveDefaultChannelsAction, saveNotificationEventsAction, sendTestNotificationAction } from "@/app/actions/settings/notification-settings";
import type { NotifyUserMode } from "@/lib/notifications/types";
import type { SaveResult } from "@/services/system/settings-save";

/**
 * Where the Notifications part saves: the notifications of the platform by default, the ones of a
 * tenant in the tenant settings, which share the part, its dialogs and its look.
 */
export interface NotificationsApi {
    saveEvents: (eventIds: string[], patch: { enabled?: boolean; channels?: string[] | null; notifyUser?: NotifyUserMode; reminderHours?: number | null }) => Promise<SaveResult>;
    saveDefaults: (channelIds: string[]) => Promise<SaveResult>;
    sendTest: (eventId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export const PLATFORM_NOTIFICATIONS: NotificationsApi = {
    saveEvents: saveNotificationEventsAction,
    saveDefaults: saveDefaultChannelsAction,
    sendTest: sendTestNotificationAction,
};

const NotificationsApiContext = createContext<NotificationsApi>(PLATFORM_NOTIFICATIONS);

export function NotificationsApiProvider({ api, children }: { api: NotificationsApi; children: React.ReactNode }) {
    return <NotificationsApiContext.Provider value={api}>{children}</NotificationsApiContext.Provider>;
}

/** The actions the Notifications part saves with, the platform's outside a provider. */
export function useNotificationsApi(): NotificationsApi {
    return useContext(NotificationsApiContext);
}
