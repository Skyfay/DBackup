import type { StorageRole } from "@/lib/core/storage-roles";

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
    lastStatus?: string | null;
    lastError?: string | null;
    /** Storage adapters only: whether this config is a backup destination or a directory source. */
    storageRole?: StorageRole;
}

export interface AdapterManagerProps {
    type: 'database' | 'storage' | 'notification';
    title: string;
    description: string;
    canManage?: boolean;
    permissions?: string[];
    /** Storage adapters only: restricts the list to configs in this role. */
    roleFilter?: StorageRole;
    /** Storage adapters only: the role a config created from this manager instance starts with. */
    defaultRole?: StorageRole;
}
