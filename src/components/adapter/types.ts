import type { StorageRole } from "@/lib/core/storage-roles";
import type { TablePreferences } from "@/lib/core/table-preferences";
import type { ConnectionOverview } from "@/services/adapters/connection-overview";

export interface AdapterConfig {
    id: string;
    name: string;
    adapterId: string;
    type: string;
    config: string; // JSON string (sensitive keys redacted by the API DTO)
    /** Map of sensitive key -> whether a non-empty value is stored (from the list DTO). */
    secretStatus?: Record<string, boolean>;
    metadata?: string; // JSON string
    createdAt: string;
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
    lastHealthCheck?: string | null;
    lastStatus?: string | null;
    lastError?: string | null;
    /** Failed health checks in a row. One or two mean degraded, three mean offline. */
    consecutiveFailures?: number;
    /** Usage, last backup and health, present when the list was asked for `overview=true`. */
    overview?: ConnectionOverview | null;
    /** Storage adapters only: whether this config is a backup destination or a directory source. */
    storageRole?: StorageRole;
}

export interface AdapterManagerProps {
    type: 'database' | 'storage' | 'notification';
    canManage?: boolean;
    permissions?: string[];
    /** Storage adapters only: restricts the list to configs in this role. */
    roleFilter?: StorageRole;
    /** Storage adapters only: the role a config created from this manager instance starts with. */
    defaultRole?: StorageRole;
    /** Names the table's saved column layout, like "connections.databases". */
    tableId: string;
    /** The layout this user saved for the table, null for the defaults. */
    initialLayout?: TablePreferences | null;
    /** Rows as a table, as cards, or as a list beside the details. Bulk actions only exist in the table. */
    view?: "table" | "cards" | "split";
}
