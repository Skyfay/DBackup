import { PERMISSIONS, Permission } from "@/lib/auth/permissions";

const ADAPTER_PERMISSIONS: Record<string, Permission> = {
    mysql: PERMISSIONS.SOURCES.VIEW,
    mariadb: PERMISSIONS.SOURCES.VIEW,
    postgres: PERMISSIONS.SOURCES.VIEW,
    mongodb: PERMISSIONS.SOURCES.VIEW,
    sqlite: PERMISSIONS.SOURCES.VIEW,
    mssql: PERMISSIONS.SOURCES.VIEW,
    "azure-sql": PERMISSIONS.SOURCES.VIEW,
    "cloudflare-d1": PERMISSIONS.SOURCES.VIEW,
    redis: PERMISSIONS.SOURCES.VIEW,
    valkey: PERMISSIONS.SOURCES.VIEW,
    firebird: PERMISSIONS.SOURCES.VIEW,

    "local-filesystem": PERMISSIONS.DESTINATIONS.READ,
    // Source-only, but still a storage adapter, and DESTINATIONS.READ is the permission
    // governing saved storage configs whichever role they hold - the same reason a directory
    // source on SFTP sits under it.
    "docker-volume": PERMISSIONS.DESTINATIONS.READ,
    "s3-generic": PERMISSIONS.DESTINATIONS.READ,
    "s3-aws": PERMISSIONS.DESTINATIONS.READ,
    "s3-r2": PERMISSIONS.DESTINATIONS.READ,
    "s3-hetzner": PERMISSIONS.DESTINATIONS.READ,
    sftp: PERMISSIONS.DESTINATIONS.READ,
    smb: PERMISSIONS.DESTINATIONS.READ,
    webdav: PERMISSIONS.DESTINATIONS.READ,
    ftp: PERMISSIONS.DESTINATIONS.READ,
    rsync: PERMISSIONS.DESTINATIONS.READ,
    "google-drive": PERMISSIONS.DESTINATIONS.READ,
    dropbox: PERMISSIONS.DESTINATIONS.READ,
    onedrive: PERMISSIONS.DESTINATIONS.READ,

    discord: PERMISSIONS.NOTIFICATIONS.READ,
    slack: PERMISSIONS.NOTIFICATIONS.READ,
    teams: PERMISSIONS.NOTIFICATIONS.READ,
    "generic-webhook": PERMISSIONS.NOTIFICATIONS.READ,
    gotify: PERMISSIONS.NOTIFICATIONS.READ,
    ntfy: PERMISSIONS.NOTIFICATIONS.READ,
    telegram: PERMISSIONS.NOTIFICATIONS.READ,
    "twilio-sms": PERMISSIONS.NOTIFICATIONS.READ,
    email: PERMISSIONS.NOTIFICATIONS.READ,
};

export function getPermissionForAdapter(adapterId: string): Permission | null {
    return ADAPTER_PERMISSIONS[adapterId] ?? null;
}

/**
 * The permission that governs editing a saved config of this adapter, derived
 * from the read permission rather than listed a second time so a new adapter
 * only ever has to be added to the map above.
 */
const MANAGE_BY_READ: Partial<Record<Permission, Permission>> = {
    [PERMISSIONS.SOURCES.VIEW]: PERMISSIONS.SOURCES.WRITE,
    [PERMISSIONS.DESTINATIONS.READ]: PERMISSIONS.DESTINATIONS.WRITE,
    [PERMISSIONS.NOTIFICATIONS.READ]: PERMISSIONS.NOTIFICATIONS.WRITE,
};

export function getManagePermissionForAdapter(adapterId: string): Permission | null {
    const read = getPermissionForAdapter(adapterId);
    return read ? MANAGE_BY_READ[read] ?? null : null;
}
