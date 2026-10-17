import type { StorageRole } from "@/lib/core/storage-roles";
import type { TablePreferences } from "@/lib/core/table-preferences";
import type { ConnectionOverview } from "@/services/adapters/connection-overview";
import type { ProvidedTerms, SharedTerms } from "@/lib/adapters/dto";
import type { ListedDatabases } from "@/services/adapters/connection-databases";
import type { SharedServerTerms } from "@/services/sharing/shared-server-rows";

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
    /** The tenant of the connection, which a list in All tenants shows and opens it in. */
    tenantId?: string;
    /** Set when another tenant shares the connection with this one, which uses it and never changes it. */
    provided?: ProvidedTerms;
    /** Set on a connection this tenant shares with others, for whoever may see what is shared. */
    share?: SharedTerms;
    /** A database connection on the Connections page: the databases it held at its last read, null before the first one. */
    listedDatabases?: ListedDatabases | null;
    /**
     * Set on a server of another tenant whose databases this tenant holds, which only the
     * Connections page lists. The server stays with that tenant: no address, no health check, no edit.
     */
    sharedServer?: SharedServerTerms;
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
    /**
     * Rows as a table, as cards, or as a list beside the details. Bulk actions only exist in
     * the table. Undefined while the page still measures the screen, which shows the skeleton.
     */
    view?: "table" | "cards" | "split";
    /**
     * What the New of the empty list does, like the New button beside the tabs, which in All tenants
     * first asks for the tenant. The form of this list when left out, while the viewer may add.
     */
    onCreate?: () => void;
    /**
     * Whether the tenant may add connections of this kind itself, which the platform decides. A
     * clone is a new one too. As `canManage` when left out.
     */
    canAdd?: boolean;
}
