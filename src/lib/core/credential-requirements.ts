import type { CredentialType } from "@/lib/core/credentials";

/**
 * Client-side mirror of `BaseAdapter.credentials` for every adapter.
 *
 * Kept in sync manually with the server-side adapter index files. Used by:
 * - `<CredentialPicker>` to filter the profile dropdown by type
 * - The adapter form to decide whether to render the primary/SSH picker
 *
 * NOTE: When adding a new adapter, mirror its `credentials` declaration here.
 * Adapters without a credential profile (e.g. local-filesystem) are
 * intentionally absent.
 */
export const ADAPTER_CREDENTIAL_REQUIREMENTS: Record<
    string,
    { primary?: CredentialType; ssh?: CredentialType }
> = {
    // Databases (primary user/pass + optional SSH tunnel)
    mysql: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    mariadb: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    postgres: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    mongodb: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    mssql: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    redis: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    valkey: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    firebird: { primary: "USERNAME_PASSWORD", ssh: "SSH_KEY" },
    sqlite: { ssh: "SSH_KEY" }, // local mode has no primary; SSH mode uses the slot

    // SSH-native storage (key-or-password auth as the primary identity)
    sftp: { primary: "SSH_KEY" },
    rsync: { primary: "SSH_KEY" },

    // User/Pass storage
    ftp: { primary: "USERNAME_PASSWORD" },
    smb: { primary: "USERNAME_PASSWORD" },
    webdav: { primary: "USERNAME_PASSWORD" },

    // S3 family
    "s3-aws": { primary: "ACCESS_KEY" },
    "s3-generic": { primary: "ACCESS_KEY" },
    "s3-r2": { primary: "ACCESS_KEY" },
    "s3-hetzner": { primary: "ACCESS_KEY" },

    // OAuth cloud storage (clientSecret + refreshToken in an OAUTH profile)
    "google-drive": { primary: "OAUTH" },
    dropbox: { primary: "OAUTH" },
    onedrive: { primary: "OAUTH" },

    // Notifications
    email: { primary: "SMTP" },
    gotify: { primary: "TOKEN" },
    ntfy: { primary: "TOKEN" },
    telegram: { primary: "TOKEN" },
    "twilio-sms": { primary: "TOKEN" }, // token = Twilio Auth Token; accountSid stays structural

    // Webhook notifications (URL + optional auth header in the vault)
    discord: { primary: "WEBHOOK" },
    slack: { primary: "WEBHOOK" },
    teams: { primary: "WEBHOOK" },
    "generic-webhook": { primary: "WEBHOOK" },
};

export function getCredentialRequirements(adapterId: string) {
    return ADAPTER_CREDENTIAL_REQUIREMENTS[adapterId];
}
