import { decryptConfig } from "@/lib/crypto";
import { registry } from "@/lib/core/registry";
import { ConfigurationError, NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type {
    CredentialData,
    CredentialType,
    UsernamePasswordData,
    SshKeyData,
    AccessKeyData,
    TokenData,
    SmtpData,
} from "@/lib/core/credentials";

const log = logger.child({ module: "ConfigResolver" });

/**
 * The minimum set of `AdapterConfig` fields the resolver needs.
 * Keep this loose enough to accept Prisma rows directly without forcing
 * callers to import the generated types.
 */
export interface AdapterConfigInput {
    id?: string;
    adapterId: string;
    /** Encrypted JSON string as stored in `AdapterConfig.config`. */
    config: string;
    primaryCredentialId: string | null;
    sshCredentialId: string | null;
}

/**
 * Resolves a stored `AdapterConfig` row into a fully merged plaintext config
 * by:
 *
 * 1. Parsing + decrypting the structural config (non-credential fields)
 * 2. Loading the referenced credential profiles
 * 3. Overlaying credential payloads onto the config according to the
 *    adapter's declared `credentials` requirements
 *
 * Throws `ConfigurationError` if the adapter declares a required primary
 * credential but no profile is assigned. The structural config is still
 * decrypted via `decryptConfig` because legacy structural fields (e.g.
 * `clientSecret`, `refreshToken` for OAuth adapters) live there.
 */
export async function resolveAdapterConfig(adapter: AdapterConfigInput): Promise<unknown> {
    const adapterDef = registry.get(adapter.adapterId);
    if (!adapterDef) {
        throw new NotFoundError("Adapter", adapter.adapterId);
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = decryptConfig(JSON.parse(adapter.config));
    } catch (e) {
        throw new ConfigurationError(
            adapter.adapterId,
            "Failed to parse or decrypt adapter config",
            { cause: e instanceof Error ? e : undefined }
        );
    }

    const requirements = adapterDef.credentials;

    // Adapter does not consume credential profiles - return structural config as-is
    if (!requirements) {
        return parsed;
    }

    // --- Primary slot ---
    // When the adapter declares a required primary credential, a profile must be assigned.
    if (requirements.primary) {
        if (!adapter.primaryCredentialId) {
            throw new ConfigurationError(
                adapter.adapterId,
                "A credential profile is required but none is assigned"
            );
        }
        const profile = await loadAndValidate(
            adapter.primaryCredentialId,
            requirements.primary,
            adapter.adapterId,
            "primary"
        );
        applyPrimaryOverlay(parsed, profile, requirements.primary);
    }

    // --- SSH slot (always optional at runtime - SSH mode is opt-in per adapter) ---
    if (requirements.ssh && adapter.sshCredentialId) {
        const profile = await loadAndValidate(
            adapter.sshCredentialId,
            requirements.ssh,
            adapter.adapterId,
            "ssh"
        );
        const useSshPrefix = requirements.primary !== undefined;
        applySshOverlay(parsed, profile as SshKeyData, useSshPrefix);
    }

    return parsed;
}

/**
 * Overlays credential profiles onto a plaintext (non-encrypted) config object.
 * Use this for client-driven flows (e.g. test-connection in the adapter form)
 * where the structural config is already plaintext and only the credential
 * IDs need to be resolved.
 *
 * Mutates and returns the supplied config. Throws `ConfigurationError` if a
 * required primary slot is missing or has the wrong type.
 */
export async function overlayCredentialsOnConfig(
    adapterId: string,
    config: Record<string, unknown>,
    primaryCredentialId: string | null,
    sshCredentialId: string | null
): Promise<Record<string, unknown>> {
    const adapterDef = registry.get(adapterId);
    if (!adapterDef) {
        throw new NotFoundError("Adapter", adapterId);
    }

    const requirements = adapterDef.credentials;
    if (!requirements) return config;

    if (requirements.primary && primaryCredentialId) {
        const profile = await loadAndValidate(
            primaryCredentialId,
            requirements.primary,
            adapterId,
            "primary"
        );
        applyPrimaryOverlay(config, profile, requirements.primary);
    }

    if (requirements.ssh && sshCredentialId) {
        const profile = await loadAndValidate(
            sshCredentialId,
            requirements.ssh,
            adapterId,
            "ssh"
        );
        const useSshPrefix = requirements.primary !== undefined;
        applySshOverlay(config, profile as SshKeyData, useSshPrefix);
    }

    return config;
}

async function loadAndValidate(
    profileId: string,
    expected: CredentialType,
    adapterId: string,
    slot: "primary" | "ssh"
): Promise<CredentialData> {
    try {
        const data = await getDecryptedCredentialData(profileId, expected);
        return data;
    } catch (e) {
        log.error(
            "Failed to load credential profile for adapter",
            { adapterId, slot, profileId, expected },
            wrapError(e)
        );
        throw new ConfigurationError(
            adapterId,
            `Failed to load ${slot} credential profile`,
            { cause: e instanceof Error ? e : undefined, context: { profileId } }
        );
    }
}

/**
 * Overlays a primary-slot credential onto the config. Field aliases are
 * applied so that schemas using either `user`/`username`, `password`, etc.
 * all see the resolved value.
 */
function applyPrimaryOverlay(
    config: Record<string, unknown>,
    profile: CredentialData,
    type: CredentialType
): void {
    switch (type) {
        case "USERNAME_PASSWORD": {
            const p = profile as UsernamePasswordData;
            // DB adapters use `user`; storage/notification (FTP, SMB, WebDAV, Redis) use `username`
            config.user = p.username;
            config.username = p.username;
            config.password = p.password;
            return;
        }
        case "SSH_KEY": {
            // Primary SSH (e.g. SFTP, Rsync): unprefixed keys
            const p = profile as SshKeyData;
            config.username = p.username;
            config.authType = p.authType;
            if (p.password !== undefined) config.password = p.password;
            if (p.privateKey !== undefined) config.privateKey = p.privateKey;
            if (p.passphrase !== undefined) config.passphrase = p.passphrase;
            return;
        }
        case "ACCESS_KEY": {
            const p = profile as AccessKeyData;
            config.accessKeyId = p.accessKeyId;
            config.secretAccessKey = p.secretAccessKey;
            return;
        }
        case "TOKEN": {
            const p = profile as TokenData;
            // Write to all known token field names. Each notification adapter
            // schema uses a different key (Gotify: appToken, ntfy: accessToken,
            // Telegram: botToken) and zod strips unknowns it doesn't declare,
            // so spraying is safe and avoids per-adapter switch logic.
            config.token = p.token;
            config.appToken = p.token;
            config.accessToken = p.token;
            config.botToken = p.token;
            return;
        }
        case "SMTP": {
            const p = profile as SmtpData;
            config.user = p.user;
            config.password = p.password;
            return;
        }
    }
}

/**
 * Overlays an SSH-slot credential onto the config.
 * - If the adapter also has a primary slot (DB adapters with SSH tunnel),
 *   credentials are written to `ssh*` prefixed fields to avoid clobbering
 *   primary credentials.
 * - If the adapter has no primary slot (e.g. SQLite SSH mode), unprefixed
 *   field names are used to match the schema.
 */
function applySshOverlay(
    config: Record<string, unknown>,
    profile: SshKeyData,
    useSshPrefix: boolean
): void {
    const k = useSshPrefix
        ? {
              username: "sshUsername",
              authType: "sshAuthType",
              password: "sshPassword",
              privateKey: "sshPrivateKey",
              passphrase: "sshPassphrase",
          }
        : {
              username: "username",
              authType: "authType",
              password: "password",
              privateKey: "privateKey",
              passphrase: "passphrase",
          };

    config[k.username] = profile.username;
    config[k.authType] = profile.authType;
    if (profile.password !== undefined) config[k.password] = profile.password;
    if (profile.privateKey !== undefined) config[k.privateKey] = profile.privateKey;
    if (profile.passphrase !== undefined) config[k.passphrase] = profile.passphrase;
}
