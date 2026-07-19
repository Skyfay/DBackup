
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
    /** Storage adapters only: whether this config can be picked as a directory-backup source. */
    usableAsSource?: boolean;
    /** Storage adapters only: whether this config can be picked as a backup destination. */
    usableAsDestination?: boolean;
}

export interface AdapterManagerProps {
    type: 'database' | 'storage' | 'notification';
    title: string;
    description: string;
    canManage?: boolean;
    permissions?: string[];
    /** Storage adapters only: restricts the list to configs enabled for this role. */
    roleFilter?: 'source' | 'destination';
    /** Storage adapters only: role flags a newly-created config from this manager instance starts with. */
    defaultRoles?: { usableAsSource: boolean; usableAsDestination: boolean };
}
