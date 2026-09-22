import { Bell, BellOff, Eye, EyeOff, Trash } from "lucide-react";
import type { BulkAction } from "@/components/ui/data-table";
import { requestBulk } from "@/lib/bulk-request";
import type { AdapterConfig } from "./types";
import { kindNames, type ConnectionKind } from "./connection-columns";
import { adapterTypeIcon } from "./connection-type-icon";

const UPDATED = { verb: "update", verbPast: "updated", noun: "connection" };

function flags(config: AdapterConfig): { healthNotificationsDisabled?: boolean; isRestoreExcluded?: boolean } {
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

const run = (action: string) => (rows: AdapterConfig[]) =>
    requestBulk("/api/adapters/bulk", { action, ids: rows.map((config) => config.id) });

/**
 * A setting switched on many connections at once. It only shows while at least one selected
 * connection would change, so the menu never offers what is already so. A later setting that
 * only some adapters know would hide itself through `isAvailable` as soon as one of those
 * without it is selected.
 */
function setting(
    id: string,
    label: string,
    group: string,
    icon: BulkAction<AdapterConfig>["icon"],
    changes: (config: AdapterConfig) => boolean,
): BulkAction<AdapterConfig> {
    return {
        id,
        labels: UPDATED,
        label: () => label,
        group,
        placement: "menu",
        icon,
        ...ITEM,
        isAvailable: (rows) => rows.some(changes),
        run: run(id),
    };
}

/**
 * What a selection of connections can do together. Every list can delete. Databases also
 * switch their health check notifications and whether they are restore targets, which every
 * database adapter supports. The other lists keep to deleting for now, their settings differ
 * too much from one adapter to the next.
 */
export function connectionBulkActions(kind: ConnectionKind, canManage: boolean): BulkAction<AdapterConfig>[] {
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
        run: run("delete"),
    };

    if (kind !== "database") return [remove];

    return [
        remove,
        setting("disable-health-alerts", "Turn off notifications", "Health check notifications", BellOff, (config) => !flags(config).healthNotificationsDisabled),
        setting("enable-health-alerts", "Turn on notifications", "Health check notifications", Bell, (config) => flags(config).healthNotificationsDisabled === true),
        setting("exclude-from-restore", "Exclude from restore", "Restore", EyeOff, (config) => !flags(config).isRestoreExcluded),
        setting("include-in-restore", "Include in restore", "Restore", Eye, (config) => flags(config).isRestoreExcluded === true),
    ];
}
