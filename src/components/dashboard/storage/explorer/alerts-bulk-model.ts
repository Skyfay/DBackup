/**
 * The alerts of several destinations as the bulk dialog shows them: how the destinations have an
 * alert now, what the dialog would leave each one at, and what goes to the server.
 */
import { formatBytes } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";

export type AlertKey = "usageSpike" | "storageLimit" | "missingBackup";
/** Keep leaves every destination as it is, On sets the value for all of them, Off turns the alert off. */
export type AlertChoice = "keep" | "on" | "off";

export const ALERT_KEYS: AlertKey[] = ["usageSpike", "storageLimit", "missingBackup"];
export const ALERT_NAMES: Record<AlertKey, string> = { usageSpike: "Usage spike", storageLimit: "Storage limit", missingBackup: "Missing backup" };

/** An alert of one destination: whether it is on, and its percentage, size in bytes or hours. */
export interface AlertValue {
    enabled: boolean;
    value: number;
}

export interface AlertSetting {
    choice: AlertChoice;
    /** What On sets. */
    value: number;
}

export type AlertSettings = Record<AlertKey, AlertSetting>;

/** What goes to the server: an alert off, or on with its value. One left out stays as it is. */
export interface AlertChangesInput {
    usageSpike?: { enabled: boolean; percent?: number };
    storageLimit?: { enabled: boolean; bytes?: number };
    missingBackup?: { enabled: boolean; hours?: number };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Joins names like a sentence does: "a", "a and b", "a, b and c". */
export function listOf(names: string[]): string {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function alertOf(destination: ExplorerDestination, key: AlertKey): AlertValue {
    const { usageSpike, storageLimit, missingBackup } = destination.alerts;
    if (key === "usageSpike") return { enabled: usageSpike.enabled, value: usageSpike.percent };
    if (key === "storageLimit") return { enabled: storageLimit.enabled, value: storageLimit.bytes };
    return { enabled: missingBackup.enabled, value: missingBackup.hours };
}

const amount = (key: AlertKey, value: number) =>
    key === "usageSpike" ? `${value} %` : key === "storageLimit" ? formatBytes(value) : plural(value, "hour");

/** An alert in the row of a destination: "On at 20 %", "Above 40 GB", "After 26 hours" or "Off". */
export function valueText(key: AlertKey, alert: AlertValue): string {
    if (!alert.enabled) return "Off";
    if (key === "usageSpike") return `On at ${amount(key, alert.value)}`;
    return `${key === "storageLimit" ? "Above" : "After"} ${amount(key, alert.value)}`;
}

/** The values the destinations with the alert on have, like "with 20 %" or "after 24 to 48 hours". */
function rangeText(key: AlertKey, values: number[]): string {
    const lead = key === "usageSpike" ? "with" : key === "storageLimit" ? "above" : "after";
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (low === high) return `${lead} ${amount(key, low)}`;
    if (key === "storageLimit") return `${lead} ${formatBytes(low)} to ${formatBytes(high)}`;
    return `${lead} ${low} to ${amount(key, high)}`;
}

/** How the destinations have an alert now, in one line under its name. */
export function nowText(key: AlertKey, destinations: ExplorerDestination[]): string {
    const count = destinations.length;
    const on = destinations.filter((destination) => alertOf(destination, key).enabled);
    if (on.length === 0) return count === 1 ? "Off" : `Off at all ${count}`;
    const range = rangeText(key, on.map((destination) => alertOf(destination, key).value));
    if (on.length === count) return count === 1 ? `On, ${range}` : `On at all ${count}, ${range}`;
    const where = on.length === 1 ? `On at ${on[0].name}` : `On at ${on.length} of ${count}`;
    return `${where} ${range}, off at ${count - on.length}`;
}

/** Where On starts: the value most of the destinations with the alert on have, or else most of all of them. */
export function startValue(key: AlertKey, destinations: ExplorerDestination[]): number {
    const alerts = destinations.map((destination) => alertOf(destination, key));
    const on = alerts.filter((alert) => alert.enabled && alert.value > 0).map((alert) => alert.value);
    const pool = on.length > 0 ? on : alerts.map((alert) => alert.value).filter((value) => value > 0);
    const counts = new Map<number, number>();
    for (const value of pool) counts.set(value, (counts.get(value) ?? 0) + 1);
    let best: number | undefined;
    for (const [value, count] of counts) if (best === undefined || count > (counts.get(best) ?? 0)) best = value;
    return best ?? (key === "usageSpike" ? 50 : key === "storageLimit" ? 10 * 1024 ** 3 : 48);
}

/** What the dialog would leave an alert at. Off keeps the value, for when it is turned on again. */
export function afterOf(before: AlertValue, setting: AlertSetting): AlertValue {
    if (setting.choice === "keep") return before;
    if (setting.choice === "off") return { enabled: false, value: before.value };
    return { enabled: true, value: setting.value };
}

export function differs(before: AlertValue, after: AlertValue): boolean {
    return before.enabled !== after.enabled || (after.enabled && before.value !== after.value);
}

/** A storage limit below what the destination stores fires as soon as it is saved, unless it fired already. */
export function firesRightAway(destination: ExplorerDestination, key: AlertKey, before: AlertValue, after: AlertValue): boolean {
    if (key !== "storageLimit" || !after.enabled) return false;
    const firedBefore = before.enabled && destination.size > before.value;
    return destination.size > after.value && !firedBefore;
}

/** The destinations the dialog changes, in the order they were picked. */
export function changedDestinations(destinations: ExplorerDestination[], settings: AlertSettings): ExplorerDestination[] {
    return destinations.filter((destination) =>
        ALERT_KEYS.some((key) => differs(alertOf(destination, key), afterOf(alertOf(destination, key), settings[key]))),
    );
}

/** The line in the foot: what changes where, and a limit that fires right away. */
export function summaryText(destinations: ExplorerDestination[], settings: AlertSettings): string {
    const count = destinations.length;
    const at = (changed: number) => (changed === count ? `all ${count}` : `${changed} of ${count}`);
    const perAlert = ALERT_KEYS.map((key) => ({
        key,
        changed: destinations.filter((destination) => differs(alertOf(destination, key), afterOf(alertOf(destination, key), settings[key]))).length,
    })).filter((entry) => entry.changed > 0);
    if (perAlert.length === 0) return "Nothing changes yet";

    const changedCount = changedDestinations(destinations, settings).length;
    const what = perAlert.length === 1 ? `${ALERT_NAMES[perAlert[0].key]} changes at ${at(perAlert[0].changed)}` : `${perAlert.length} alerts change at ${at(changedCount)}`;
    const firing = destinations.filter((destination) => {
        const before = alertOf(destination, "storageLimit");
        return firesRightAway(destination, "storageLimit", before, afterOf(before, settings.storageLimit));
    });
    return firing.length > 0 ? `${what}. The storage limit fires right away at ${listOf(firing.map((destination) => destination.name))}` : what;
}

/** The alerts the dialog set, as the server takes them. */
export function changesOf(settings: AlertSettings): AlertChangesInput {
    const field = { usageSpike: "percent", storageLimit: "bytes", missingBackup: "hours" } as const;
    const changes: AlertChangesInput = {};
    for (const key of ALERT_KEYS) {
        const setting = settings[key];
        if (setting.choice === "keep") continue;
        changes[key] = setting.choice === "on" ? { enabled: true, [field[key]]: setting.value } : { enabled: false };
    }
    return changes;
}
