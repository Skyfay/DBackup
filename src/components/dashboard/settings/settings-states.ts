import { LEVEL_NAMES } from "@/lib/auth/password-policy";
import { formatBytes } from "@/lib/utils";
import type { SettingsModel } from "@/services/system/settings-types";
import type { SettingsPartId } from "./settings-parts";

/** The state a part shows beside its name in the navigation, like how long the certificate has left. */
export interface PartState {
    text: string;
    /** A state that needs a look, as a dot in its color. */
    tone?: "warning" | "destructive";
}

/** When the certificate starts to warn, like the part itself. */
export const CERTIFICATE_WARN_DAYS = 30;

function certificateState(certificate: SettingsModel["certificate"]): PartState | null {
    if (!certificate || certificate.error) return { text: "Unreadable", tone: "warning" };
    if (!certificate.isHttpsEnabled) return { text: "Off" };
    if (!certificate.exists) return { text: "No certificate", tone: "warning" };
    if (certificate.expired) return { text: "Expired", tone: "destructive" };
    if (certificate.daysRemaining <= CERTIFICATE_WARN_DAYS) {
        return { text: certificate.daysRemaining === 1 ? "1 day" : certificate.daysRemaining < 1 ? "Today" : `${certificate.daysRemaining} days`, tone: "warning" };
    }
    return null;
}

function configBackupState({ settings, lastRun }: SettingsModel["configBackup"]): PartState | null {
    if (!settings.enabled) return { text: "Off", tone: "warning" };
    if (lastRun && !lastRun.ok) return { text: "Failed", tone: "warning" };
    return null;
}

/** How many events are on, or in amber how many of them go nowhere. */
function notificationState({ events, channels, defaultChannels }: SettingsModel["notifications"]): PartState {
    const known = new Set(channels.map((channel) => channel.id));
    const nowhere = events.filter((event) => event.enabled && (event.channels ?? defaultChannels).every((id) => !known.has(id))).length;
    if (nowhere > 0) return { text: nowhere === 1 ? "1 goes nowhere" : `${nowhere} go nowhere`, tone: "warning" };
    return { text: `${events.filter((event) => event.enabled).length} of ${events.length}` };
}

/** The state of every part that has one. */
export function partStates(model: SettingsModel): Partial<Record<SettingsPartId, PartState>> {
    const problems = model.tasks.filter((task) => task.lastRun && !task.lastRun.ok).length;
    const states: Partial<Record<SettingsPartId, PartState | null>> = {
        tasks: problems > 0 ? { text: problems === 1 ? "1 problem" : `${problems} problems`, tone: "warning" } : { text: String(model.tasks.length) },
        notifications: notificationState(model.notifications),
        database: model.database ? { text: formatBytes(model.database.totalBytes, 0) } : null,
        "config-backup": configBackupState(model.configBackup),
        "recently-deleted": model.trash.length > 0 ? { text: String(model.trash.length) } : null,
        passwords: { text: LEVEL_NAMES[model.passwords.level] },
        https: certificateState(model.certificate),
    };
    return Object.fromEntries(Object.entries(states).filter(([, state]) => state)) as Partial<Record<SettingsPartId, PartState>>;
}
