"use client";

import Link from "next/link";
import { ArrowUpRight, Globe } from "lucide-react";
import { saveTenantDefaultChannelsAction, saveTenantNotificationEventsAction, sendTenantTestNotificationAction } from "@/app/actions/tenant/tenant-settings";
import { NotificationsApiProvider, type NotificationsApi } from "@/components/dashboard/settings/notification-api";
import { NotificationsPart } from "@/components/dashboard/settings/notifications-part";
import { PartFrame } from "@/components/dashboard/settings/settings-frame";
import { Button } from "@/components/ui/button";
import type { TenantSettingsModel } from "@/services/tenant/tenant-settings-model";

/** The Notifications part saving into the settings of the open tenant. */
const TENANT_NOTIFICATIONS: NotificationsApi = {
    // Reminders and mails to a person are the platform's, so only the switch and the channels go along.
    saveEvents: (eventIds, patch) => saveTenantNotificationEventsAction(eventIds, { enabled: patch.enabled, channels: patch.channels }),
    saveDefaults: saveTenantDefaultChannelsAction,
    sendTest: sendTenantTestNotificationAction,
};

interface TenantNotificationsPartProps {
    model: TenantSettingsModel;
    openEventId: string | null;
    onOpened: () => void;
}

/**
 * Where the events of the open tenant go: its own channels, its default ones and every event of
 * its own data with a switch, like the Notifications of the platform. The home tenant hears about
 * its data through the notifications of the platform, which this part leads to.
 */
export function TenantNotificationsPart({ model, openEventId, onOpened }: TenantNotificationsPartProps) {
    if (!model.notifications) {
        return (
            <PartFrame part="tenant-notifications">
                <div data-setting="tenant-notifications.events" className="flex max-w-2xl flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-start">
                    <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                        <p className="font-medium">{model.tenant.name} reports through the notifications of the platform</p>
                        <p className="text-muted-foreground">
                            The home tenant holds what the platform owns, so its restores, destinations and connections go to the channels of Platform settings, Notifications. Its backups report per job.
                        </p>
                    </div>
                    {model.isPlatformAdmin && (
                        <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                            <Link href="/dashboard/platform/settings?part=notifications">
                                Open them
                                <ArrowUpRight />
                            </Link>
                        </Button>
                    )}
                </div>
            </PartFrame>
        );
    }

    return (
        <NotificationsApiProvider api={TENANT_NOTIFICATIONS}>
            <NotificationsPart model={model.notifications} openEventId={openEventId} onOpened={onOpened} part="tenant-notifications" />
        </NotificationsApiProvider>
    );
}
