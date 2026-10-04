import type { NotificationEventDefinition, NotificationEventType } from "@/lib/notifications/types";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

/**
 * The line at the foot of a mail that says why the reader gets it and where that changes, so
 * nobody has to search the settings for the switch.
 */

/** "every 24 hours", "every 7 days" */
function every(hours: number): string {
    if (hours % 24 === 0) return hours === 24 ? "every day" : `every ${hours / 24} days`;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
}

/** Why a channel gets a system event. */
export function eventReason(definition: NotificationEventDefinition | undefined, reminderHours: number | null | undefined, test: boolean): string {
    const name = definition?.name ?? "This event";
    if (test) return `This is a test of "${name}" from Settings, Notifications.`;
    const reminder = definition?.supportsReminder && reminderHours && reminderHours > 0
        ? ` While it lasts, a reminder follows ${every(reminderHours)}.`
        : "";
    return `You get this because "${name}" is on under Settings, Notifications.${reminder}`;
}

/** Why the person a sign-in or a new account is about gets a mail of their own. */
export function userReason(eventType: NotificationEventType, instanceName: string | null): string {
    const about = eventType === NOTIFICATION_EVENTS.USER_LOGIN ? "sign-ins" : "new accounts";
    return `You get this as a user of DBackup${instanceName ? ` · ${instanceName}` : ""}, since an admin turned on mails about ${about}.`;
}

/** "after every run", "when a run fails or is partial" */
function whenRuns(events: Set<string>): string {
    const success = events.has("SUCCESS");
    const partial = events.has("PARTIAL");
    const failed = events.has("FAILED");
    if (success && partial && failed) return "after every run";
    const parts = [failed && "fails", partial && "is partial", success && "succeeds"].filter(Boolean) as string[];
    return `when a run ${parts.join(" or ")}`;
}

/** Why a channel gets the outcome of a run of a job. */
export function jobReason(channelName: string, jobName: string, events: Set<string>): string {
    return `You get this through ${channelName}, which ${jobName} tells ${whenRuns(events)}. Change it in the job under Notifications.`;
}
