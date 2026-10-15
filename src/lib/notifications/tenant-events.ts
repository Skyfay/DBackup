/**
 * The events a tenant hears about on its own channels, about its own data: how its backups and
 * restores went, its destinations and connections, and the checks of its backups. Everything of
 * the platform, like a new version or a sign-in, stays in the notifications of the platform.
 */

import { getEventDefinition } from "./events";
import { NOTIFICATION_EVENTS, type NotificationEventDefinition, type NotificationEventType } from "./types";

export interface TenantEventDefinition {
    id: NotificationEventType;
    name: string;
    description: string;
    category: NotificationEventDefinition["category"];
    /** Whether it sends once the tenant has a channel, before anyone switched it. */
    defaultEnabled: boolean;
}

/** The runs of a job, which the platform hears about only through the job itself. */
const BACKUP_EVENTS: TenantEventDefinition[] = [
    { id: NOTIFICATION_EVENTS.BACKUP_FAILURE, name: "A backup failed", description: "A run of a job stopped without a backup.", category: "backup", defaultEnabled: true },
    { id: NOTIFICATION_EVENTS.BACKUP_PARTIAL, name: "A backup missed a copy", description: "A run made its backup, but a destination did not get it.", category: "backup", defaultEnabled: true },
    { id: NOTIFICATION_EVENTS.BACKUP_SUCCESS, name: "A backup succeeded", description: "A run of a job made its backup at every destination.", category: "backup", defaultEnabled: false },
];

/** The events of the platform a tenant hears about for its own data, in the words of the platform. */
const SHARED_EVENTS: NotificationEventType[] = [
    NOTIFICATION_EVENTS.RESTORE_COMPLETE,
    NOTIFICATION_EVENTS.RESTORE_FAILURE,
    NOTIFICATION_EVENTS.STORAGE_USAGE_SPIKE,
    NOTIFICATION_EVENTS.STORAGE_LIMIT_WARNING,
    NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP,
    NOTIFICATION_EVENTS.AIRGAP_SKIPPED,
    NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
    NOTIFICATION_EVENTS.CONNECTION_ONLINE,
    NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
    NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
];

export const TENANT_EVENT_DEFINITIONS: TenantEventDefinition[] = [
    ...BACKUP_EVENTS,
    ...SHARED_EVENTS.flatMap((id): TenantEventDefinition[] => {
        const definition = getEventDefinition(id);
        return definition ? [{ id, name: definition.name, description: definition.description, category: definition.category, defaultEnabled: definition.defaultEnabled }] : [];
    }),
];

const BY_ID = new Map(TENANT_EVENT_DEFINITIONS.map((definition) => [definition.id as string, definition]));

/** The event as a tenant sees it, undefined for an event of the platform alone. */
export function getTenantEventDefinition(eventType: string): TenantEventDefinition | undefined {
    return BY_ID.get(eventType);
}

/** Whether a tenant may hear about the event on its own channels. */
export function isTenantEvent(eventType: string): boolean {
    return BY_ID.has(eventType);
}
