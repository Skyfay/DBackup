import { z } from "zod";

/**
 * Credential profile types.
 *
 * Each type defines the shape of the encrypted `data` payload stored on a
 * `CredentialProfile` row. Adapters declare which type they accept via the
 * optional `credentials` field on `BaseAdapter`.
 */
export const CREDENTIAL_TYPES = [
    "USERNAME_PASSWORD",
    "SSH_KEY",
    "ACCESS_KEY",
    "TOKEN",
    "SMTP",
    "WEBHOOK",
    "OAUTH",
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type payload schemas
// ---------------------------------------------------------------------------

export const UsernamePasswordSchema = z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
});

/**
 * Key types DBackup can generate itself. Ed25519 is the default everywhere.
 * The rest exist for hosts too old to accept it.
 */
export const SSH_KEY_TYPES = ["ed25519", "rsa-4096", "ecdsa-p256", "ecdsa-p384"] as const;

export type SshKeyType = (typeof SSH_KEY_TYPES)[number];

/**
 * Asks the server to generate the private key instead of carrying one.
 * Sent in place of `privateKey` inside an `SSH_KEY` payload, so the key material is created
 * where it is stored and no private key ever travels to a browser.
 */
export const SshKeyGenerateSchema = z.object({
    keyType: z.enum(SSH_KEY_TYPES),
    comment: z.string().max(120).optional(),
    /** Encrypts the generated key. Stored with it, so backups still run unattended. */
    passphrase: z.string().optional(),
});

export const SshKeySchema = z
    .object({
        username: z.string().min(1, "Username is required"),
        authType: z.enum(["password", "privateKey", "agent"]),
        password: z.string().optional(),
        privateKey: z.string().optional(),
        passphrase: z.string().optional(),
        // Public half of `privateKey`, kept so a profile can show which key to install on a
        // host. Not a secret, and filled in by the service rather than by the client.
        publicKey: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if (data.authType === "password" && !data.password) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["password"],
                message: "Password is required when authType is 'password'",
            });
        }
        if (data.authType === "privateKey" && !data.privateKey) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["privateKey"],
                message: "Private key is required when authType is 'privateKey'",
            });
        }
    });

export const AccessKeySchema = z.object({
    accessKeyId: z.string().min(1, "Access Key ID is required"),
    secretAccessKey: z.string().min(1, "Secret Access Key is required"),
});

export const TokenSchema = z.object({
    token: z.string().min(1, "Token is required"),
});

export const SmtpSchema = z.object({
    user: z.string().min(1, "User is required"),
    password: z.string().min(1, "Password is required"),
});

export const WebhookSchema = z.object({
    url: z.string().url("Valid Webhook URL is required"),
    authHeader: z.string().optional(),
});

export const OAuthSchema = z.object({
    // clientId + clientSecret form one OAuth-app registration; keeping them together
    // (with the refreshToken) avoids the mismatch where a refreshToken issued for one
    // clientId is used with another. clientId is not itself a secret.
    clientId: z.string().min(1, "Client ID is required"),
    clientSecret: z.string().min(1, "Client Secret is required"),
    // Set automatically by the OAuth callback after the consent flow; optional so
    // the profile can be created up-front with just the client id + secret.
    refreshToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Type-to-schema map (single source of truth for validation)
// ---------------------------------------------------------------------------

export const CREDENTIAL_SCHEMAS = {
    USERNAME_PASSWORD: UsernamePasswordSchema,
    SSH_KEY: SshKeySchema,
    ACCESS_KEY: AccessKeySchema,
    TOKEN: TokenSchema,
    SMTP: SmtpSchema,
    WEBHOOK: WebhookSchema,
    OAUTH: OAuthSchema,
} as const satisfies Record<CredentialType, z.ZodTypeAny>;

export type UsernamePasswordData = z.infer<typeof UsernamePasswordSchema>;
export type SshKeyData = z.infer<typeof SshKeySchema>;
export type AccessKeyData = z.infer<typeof AccessKeySchema>;
export type TokenData = z.infer<typeof TokenSchema>;
export type SmtpData = z.infer<typeof SmtpSchema>;
export type WebhookData = z.infer<typeof WebhookSchema>;
export type OAuthData = z.infer<typeof OAuthSchema>;

export type CredentialData =
    | UsernamePasswordData
    | SshKeyData
    | AccessKeyData
    | TokenData
    | SmtpData
    | WebhookData
    | OAuthData;

/**
 * A credential profile as exposed to clients (no `data` payload).
 * The encrypted payload is intentionally never serialized to API responses
 * unless the explicit reveal endpoint is used.
 */
export interface CredentialProfileShape {
    id: string;
    name: string;
    type: CredentialType;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    /**
     * Which sensitive fields of the (encrypted) payload hold a non-empty value,
     * e.g. `{ clientSecret: true, refreshToken: false }`. Lets the UI tell whether
     * an OAUTH profile has been authorized (refreshToken present) WITHOUT exposing
     * any secret value. Never contains the values themselves.
     */
    secretStatus?: Record<string, boolean>;
    /**
     * `SSH_KEY` profiles on private-key auth: the `authorized_keys` line for the stored key,
     * and the `SHA256:...` fingerprint derived from it. The public half is not a secret, so
     * both come back with `CREDENTIALS.READ` and without a reveal audit entry.
     */
    publicKey?: string;
    fingerprint?: string;
}

/**
 * Adapter-side declaration of which credential types an adapter accepts.
 * Set on `BaseAdapter.credentials` in each adapter's `index.ts`.
 */
export interface AdapterCredentialRequirements {
    /** Credential type for the primary connection. Undefined = no profile required. */
    primary?: CredentialType;
    /** Credential type for the optional SSH tunnel. */
    ssh?: CredentialType;
    /**
     * When true, the adapter can operate without a primary credential profile.
     * The config resolver skips the "missing credential" error if no profile is
     * assigned and falls back to the structural config values.
     */
    primaryOptional?: boolean;
}

/**
 * Validates a credential payload against its declared type schema.
 * Returns the parsed/typed payload on success; throws `ZodError` on failure.
 */
export function parseCredentialData(type: CredentialType, raw: unknown): CredentialData {
    const schema = CREDENTIAL_SCHEMAS[type];
    return schema.parse(raw) as CredentialData;
}
