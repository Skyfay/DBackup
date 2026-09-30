"use client";

import { NotificationSettings } from "@/components/settings/notification-settings";
import { PartFrame, useSettingsFrame } from "./settings-frame";

/**
 * The notification settings as they were before the redesign of the page, until they get a
 * design of their own. They load and save by themselves, and the fieldset keeps a viewer who may
 * only read from changing them.
 */
export function NotificationsPart() {
    const { readOnly } = useSettingsFrame();
    return (
        <PartFrame part="notifications" flush>
            <fieldset disabled={readOnly} className="min-w-0 px-4 py-5 md:px-6" data-setting="notifications.events">
                <NotificationSettings />
            </fieldset>
        </PartFrame>
    );
}
