import { Bell, BellOff, Eye, EyeOff, Plug, ShieldCheck, ShieldOff, Trash, Unplug } from "lucide-react";
import type { BulkAction, BulkTrash } from "@/components/ui/data-table";
import { requestBulk } from "@/lib/bulk-request";
import { isAirGapped } from "@/lib/core/air-gap";
import type { AdapterConfig } from "./types";
import { kindNames, type ConnectionKind } from "./connection-columns";
import { adapterTypeIcon } from "./connection-type-icon";

const UPDATED = { verb: "update", verbPast: "updated", noun: "connection" };

function flags(config: AdapterConfig): { healthNotificationsDisabled?: boolean; isRestoreExcluded?: boolean; skipVerification?: boolean; airGapped?: boolean } {
    try {
        return config.metadata ? JSON.parse(config.metadata) : {};
    } catch {
        return {};
    }
}

/** How a connection shows in the confirmation and in the list of failures. */
const ITEM = {
    itemName: (config: AdapterConfig) => config.name,
    itemIcon: (config: AdapterConfig) => adapterTypeIcon(config.adapterId),
    itemDetail: (config: AdapterConfig) => kindNames.get(config.adapterId) ?? config.adapterId,
};

/**
 * Why a connection cannot be deleted yet, or null. Mirrors the refusal in `describeAdapterUsage`:
 * jobs using it as source, destination or directory source, and notification templates sending
 * through it. A job that only sends its own notifications through a channel does not hold it.
 * The server checks again, so a use added meanwhile still shows up in the failure list.
 */
export function deleteBlocker(config: AdapterConfig): string | null {
    const usedBy = config.overview?.usedBy;
    if (!usedBy) return null;
    const jobs = config.type === "notification" ? 0 : usedBy.jobs;
    const parts = [
        ...(jobs > 0 ? [`${jobs} job${jobs === 1 ? "" : "s"}`] : []),
        ...(usedBy.templates > 0 ? [`${usedBy.templates} notification template${usedBy.templates === 1 ? "" : "s"}`] : []),
    ];
    return parts.length > 0 ? `Used by ${parts.join(" and ")}` : null;
}

const run = (action: string) => (rows: AdapterConfig[], { permanently }: { permanently: boolean } = { permanently: false }) =>
    requestBulk("/api/adapters/bulk", { action, ids: rows.map((config) => config.id), ...(permanently ? { permanently } : {}) });

/**
 * A setting switched on many connections at once. It only shows while at least one selected
 * connection would change, so the menu never offers what is already so. A connection the setting
 * does not apply to is `ineligible`, left out and never sent.
 */
function setting(
    id: string,
    label: string,
    group: string,
    icon: BulkAction<AdapterConfig>["icon"],
    changes: (config: AdapterConfig) => boolean,
    ineligible?: (config: AdapterConfig) => string | null,
): BulkAction<AdapterConfig> {
    return {
        id,
        labels: UPDATED,
        label: () => label,
        group,
        placement: "menu",
        icon,
        ...ITEM,
        ...(ineligible ? { ineligible } : {}),
        isAvailable: (rows) => rows.some((config) => !ineligible?.(config) && changes(config)),
        run: run(id),
    };
}

/** An air-gapped destination sends no health alerts at all, so its form shows the switch off and locked. */
const noHealthAlerts = (config: AdapterConfig) => (isAirGapped(config) ? "It is air-gapped and sends no health alerts" : null);

/**
 * What a selection of connections can do together. Every list can delete, into Recently deleted
 * with `trash`. Databases, directory sources and destinations also switch their health check
 * notifications, databases whether they are restore targets, and destinations their integrity
 * checks and whether they are air-gapped, the switches of the Behavior part every adapter of the
 * kind has. Notification channels keep to deleting.
 */
export function connectionBulkActions(kind: ConnectionKind, canManage: boolean, trash: Omit<BulkTrash<AdapterConfig>, "permanentLine">): BulkAction<AdapterConfig>[] {
    if (!canManage) return [];

    const remove: BulkAction<AdapterConfig> = {
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "connection" },
        icon: Trash,
        variant: "destructive",
        ...ITEM,
        // Connections still in use are listed apart in the confirmation and never sent.
        ineligible: deleteBlocker,
        confirm: {
            title: (rows) => `Delete ${rows.length} connection${rows.length === 1 ? "" : "s"}?`,
            confirmLabel: "Delete",
        },
        trash: {
            ...trash,
            permanentLine: (rows) => (rows.length === 1
                ? "It skips Recently deleted, with the login it holds. Backups it stored stay where they are."
                : "They skip Recently deleted, with the logins they hold. Backups they stored stay where they are."),
        },
        run: run("delete"),
    };

    if (kind === "notification") return [remove];

    const healthAlerts = [
        setting("disable-health-alerts", "Turn off notifications", "Health check notifications", BellOff, (config) => !flags(config).healthNotificationsDisabled, noHealthAlerts),
        setting("enable-health-alerts", "Turn on notifications", "Health check notifications", Bell, (config) => flags(config).healthNotificationsDisabled === true, noHealthAlerts),
    ];
    if (kind === "source") return [remove, ...healthAlerts];
    if (kind === "destination") {
        return [
            remove,
            ...healthAlerts,
            setting("disable-integrity-checks", "Turn off integrity checks", "Integrity checks", ShieldOff, (config) => !flags(config).skipVerification),
            setting("enable-integrity-checks", "Turn on integrity checks", "Integrity checks", ShieldCheck, (config) => flags(config).skipVerification === true),
            setting("mark-air-gapped", "Mark as air-gapped", "Air-gapped", Unplug, (config) => !flags(config).airGapped),
            setting("unmark-air-gapped", "Mark as not air-gapped", "Air-gapped", Plug, (config) => flags(config).airGapped === true),
        ];
    }

    return [
        remove,
        ...healthAlerts,
        setting("exclude-from-restore", "Exclude from restore", "Restore", EyeOff, (config) => !flags(config).isRestoreExcluded),
        setting("include-in-restore", "Include in restore", "Restore", Eye, (config) => flags(config).isRestoreExcluded === true),
    ];
}
