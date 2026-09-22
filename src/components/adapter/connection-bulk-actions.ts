import { Bell, BellOff, Eye, EyeOff, Trash } from "lucide-react";
import type { BulkAction } from "@/components/ui/data-table";
import { requestBulk } from "@/lib/bulk-request";
import type { AdapterConfig } from "./types";
import type { ConnectionKind } from "./connection-columns";

const UPDATED = { verb: "update", verbPast: "updated", noun: "connection" };

function flags(config: AdapterConfig): { healthNotificationsDisabled?: boolean; isRestoreExcluded?: boolean } {
    try {
        return config.metadata ? JSON.parse(config.metadata) : {};
    } catch {
        return {};
    }
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
        itemName: (config) => config.name,
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
        itemName: (config) => config.name,
        confirm: {
            title: (rows) => `Delete ${rows.length} connection${rows.length === 1 ? "" : "s"}?`,
            // A connection still referenced by a job is refused per entry rather
            // than up front, because the reason names the jobs holding it.
            description: () =>
                "This cannot be undone. Connections still used by a job or a notification template are kept and listed afterwards.",
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
