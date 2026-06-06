
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
}

export interface AdapterManagerProps {
    type: 'database' | 'storage' | 'notification';
    title: string;
    description: string;
    canManage?: boolean;
    permissions?: string[];
}
