import { decryptConfig, mergeSecrets } from "@/lib/crypto";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { ConfigurationError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import { usesPrefixedSshKeys } from "@/lib/adapters/ssh-key-convention";
import { explicitScope, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { hostLocalReason } from "@/lib/adapters/host-local";
import { requestHeaders } from "@/lib/server/request-headers";
import { assertReachFromHere, assertTenantReach } from "@/services/tenant/tenant-network";
import type {
    CredentialData,
    CredentialType,
    UsernamePasswordData,
    SshKeyData,
    AccessKeyData,
    TokenData,
    SmtpData,
    WebhookData,
    OAuthData,
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
    /**
     * The tenant of the connection. Its saved logins are read there, so a destination or a channel
     * another tenant shares works in the run of a customer, whose own scope never sees them.
     */
    tenantId: string;
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
    const resolved = await resolveConfig(adapter);
    // A connection of a customer never reaches the server DBackup runs on, also when a login it
    // names changed since it was saved, or the row came from an import, see `host-local.ts`.
    if (adapter.tenantId && adapter.tenantId !== HOME_TENANT_ID) {
        const reason = hostLocalReason(adapter.adapterId, resolved as Record<string, unknown>);
        if (reason) throw new ConfigurationError(adapter.adapterId, reason);
        // Nor the local network while its tenant blocks it, also when a name resolves elsewhere
        // since it was saved or the platform turned the block on later. A connection another
        // tenant shares follows the setting of that tenant, the one of its row.
        await assertTenantReach(adapter.tenantId, adapter.adapterId, resolved);
    }
    return resolved;
}

async function resolveConfig(adapter: AdapterConfigInput): Promise<Record<string, unknown>> {
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
    // When the adapter declares a required primary credential, a profile must be assigned
    // unless the adapter marks the primary slot as optional (e.g. Redis without auth,
    // SMTP unauthenticated relay). Optional adapters fall back to the structural config.
    if (requirements.primary) {
        if (!adapter.primaryCredentialId) {
            if (!requirements.primaryOptional) {
                throw new ConfigurationError(
                    adapter.adapterId,
                    "A credential profile is required but none is assigned"
                );
            }
            // Optional and no profile assigned - use structural config fields as-is
        } else {
            const profile = await inTenantOf(adapter, () => loadAndValidate(
                adapter.primaryCredentialId!,
                requirements.primary!,
                adapter.adapterId,
                "primary"
            ));
            applyPrimaryOverlay(parsed, profile, requirements.primary);
        }
    }

    // --- SSH slot (always optional at runtime - SSH mode is opt-in per adapter) ---
    if (requirements.ssh && adapter.sshCredentialId) {
        const profile = await inTenantOf(adapter, () => loadAndValidate(
            adapter.sshCredentialId!,
            requirements.ssh!,
            adapter.adapterId,
            "ssh"
        ));
        applySshOverlay(parsed, profile as SshKeyData, usesPrefixedSshKeys(adapterDef.configSchema));
    }

    return parsed;
}

/**
 * Whether the code that runs now may run a config that reaches the server DBackup runs on: the
 * home tenant, the system scope, and code outside a request, like a script or the start of the
 * server. A customer may not, and neither may All tenants or an account of no tenant, which act
 * for no tenant at all.
 */
export async function mayReachHost(): Promise<boolean> {
    const scope = explicitScope();
    if (scope) return scope.kind === "system" || (scope.kind === "tenant" && scope.tenantId === HOME_TENANT_ID);

    let headers: Headers;
    try {
        headers = await requestHeaders();
    } catch {
        // No request, and no scope either: a script or the start of the server.
        return true;
    }
    // Loaded here like in `tenant/current.ts`, the access control reads the database itself.
    const { getAuthContext } = await import("@/lib/auth/access-control");
    const ctx = await getAuthContext(headers).catch(() => null);
    return !!ctx && !ctx.allTenants && ctx.tenantId === HOME_TENANT_ID;
}

/**
 * Refuses a config of a form that reaches the server DBackup runs on, unless the platform runs it,
 * see `mayReachHost`, and one whose hosts lie in the local network while the tenant that runs now
 * blocks it, see `tenant-network.ts`. Every way to try a config before it is saved, like a test or
 * a read of its databases, goes through `overlayCredentialsOnConfig` or calls this.
 */
export async function assertConfigOffHost(adapterId: string, config: Record<string, unknown>): Promise<void> {
    const reason = hostLocalReason(adapterId, config);
    if (reason && !(await mayReachHost())) throw new ValidationError(reason, { field: "config" });
    await assertReachFromHere(adapterId, config);
}

/** The fields of a config that name a program on the server DBackup runs on, like `sqliteBinaryPath`. */
const BINARY_PATH = /BinaryPath$/;

/**
 * A config of a form without the fields that pick the program it runs with. A read of tables or
 * rows runs the program the saved connection names, or the default one, never one a
 * request brings along.
 */
export function withoutBinaryPaths(config: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(config).filter(([key]) => !BINARY_PATH.test(key)));
}

/**
 * Overlays credential profiles onto a plaintext (non-encrypted) config object.
 * Use this for client-driven flows (e.g. test-connection in the adapter form)
 * where the structural config is already plaintext and only the credential
 * IDs need to be resolved.
 *
 * Mutates and returns the supplied config. Throws `ConfigurationError` if a
 * required primary slot is missing or has the wrong type, and `ValidationError`
 * from `assertConfigOffHost` for a config the tenant that runs now may not run.
 */
export async function overlayCredentialsOnConfig(
    adapterId: string,
    config: Record<string, unknown>,
    primaryCredentialId: string | null,
    sshCredentialId: string | null
): Promise<Record<string, unknown>> {
    const merged = await layLoginsOver(adapterId, config, primaryCredentialId, sshCredentialId);
    await assertConfigOffHost(adapterId, merged);
    return merged;
}

/**
 * Lays the credential profiles over a plaintext config like `overlayCredentialsOnConfig`, without
 * its checks, for a caller that checks the result itself or only compares it, like where a saved
 * connection keeps its files. Mutates and returns the supplied config.
 */
export async function layLoginsOver(
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
        applySshOverlay(config, profile as SshKeyData, usesPrefixedSshKeys(adapterDef.configSchema));
    }

    return config;
}

/**
 * Fills in the secrets a client-submitted config is missing from the saved
 * config it belongs to.
 *
 * The adapter DTO deletes every key in `SENSITIVE_KEYS` before a config reaches
 * the browser, so an edit-form round trip submits secrets missing rather than
 * unchanged. For a secret held in a credential profile that is harmless, since
 * the profile is resolved server-side. For a secret that lives in the config
 * itself, such as MongoDB's deprecated inline `uri` or a legacy inline SSH key,
 * the submitted config is one the saved source never had, which is why a
 * connection test could fail while backups from that same source kept working.
 *
 * Caller-supplied values always win, so this only restores what is absent.
 * Permission is the caller's job: only somebody who may edit the source should
 * be handed its stored secrets.
 */
export async function applyStoredSecrets(
    adapterId: string,
    configId: string,
    config: Record<string, unknown>
): Promise<Record<string, unknown>> {
    try {
        const stored = await prisma.adapterConfig.findUnique({
            where: { id: configId },
            select: { adapterId: true, config: true },
        });

        // A config of another type holds other keys, so merging one into the
        // other would only ever produce a config nobody asked about.
        if (!stored || stored.adapterId !== adapterId) return config;

        return mergeSecrets(config, decryptConfig(JSON.parse(stored.config)));
    } catch (e) {
        // A stored config that cannot be read is no reason to refuse the request.
        log.error("Failed to merge stored secrets into config", { adapterId, configId }, wrapError(e));
        return config;
    }
}

/** Runs a read of a saved login in the tenant of its connection, when the row names it. */
function inTenantOf<T>(adapter: AdapterConfigInput, read: () => Promise<T>): Promise<T> {
    return adapter.tenantId ? runAsTenant(adapter.tenantId, read) : read();
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
            // Telegram: botToken, Twilio: authToken) and zod strips unknowns it
            // doesn't declare, so spraying is safe and avoids per-adapter switch logic.
            config.token = p.token;
            config.appToken = p.token;
            config.accessToken = p.token;
            config.botToken = p.token;
            config.authToken = p.token;
            return;
        }
        case "SMTP": {
            const p = profile as SmtpData;
            config.user = p.user;
            config.password = p.password;
            return;
        }
        case "WEBHOOK": {
            const p = profile as WebhookData;
            // Discord/Slack/Teams use `webhookUrl`; the generic webhook also uses
            // an optional `authHeader`. Spray both known field names.
            config.webhookUrl = p.url;
            config.url = p.url;
            if (p.authHeader !== undefined) config.authHeader = p.authHeader;
            return;
        }
        case "OAUTH": {
            const p = profile as OAuthData;
            config.clientId = p.clientId;
            config.clientSecret = p.clientSecret;
            if (p.refreshToken !== undefined) config.refreshToken = p.refreshToken;
            return;
        }
    }
}

/**
 * Overlays an SSH-slot credential onto the config.
 *
 * Which names it writes is decided by the adapter's schema, not by whether it also has a
 * primary slot - see `ssh-key-convention.ts`. Most adapters spread `sshFields` and get
 * `ssh*` names, which keeps an SSH identity from clobbering a database login. SQLite has no
 * database login and reuses the plain names.
 *
 * This used to be inferred from the primary slot, which was a proxy that held only while
 * SQLite was the sole adapter without one. Docker volumes has no primary slot either - a
 * Docker socket has no login - but prefixed names, and the mismatch meant its SSH mode
 * could never connect.
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
