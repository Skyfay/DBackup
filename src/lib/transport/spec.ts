import { ConfigurationError } from "@/lib/logging/errors";
import { reachOf, type ReachPolicy } from "@/lib/network/reach-policy";
import { hostKeyOf, type SshHostKeyPolicy } from "./host-key";
import type { SshConnectionConfig, TransportResolver, TransportSpec } from "./types";

/**
 * Turning a stored adapter config into a TransportSpec.
 *
 * Two conventions exist in the database and neither can be migrated away
 * without touching stored rows, so both are read here instead:
 *   - most adapters use `connectionMode` plus prefixed `sshHost` / `sshUsername`
 *   - SQLite uses `mode` plus unprefixed `host` / `username`, because its
 *     credential slot has no primary and config-resolver.ts writes unprefixed keys
 *
 * Resolution is per adapter on purpose. RedisSchema already has an unrelated
 * `mode` field ("standalone" / "sentinel"), so a generic reader sniffing for
 * `config.mode === "ssh"` would be one careless edit away from misfiring.
 */

export interface SshKeyMap {
    host: string;
    port: string;
    username: string;
    authType: string;
    password: string;
    privateKey: string;
    passphrase: string;
}

/** The `sshFields` convention from definitions/shared.ts. */
export const PREFIXED_SSH_KEYS: SshKeyMap = {
    host: "sshHost",
    port: "sshPort",
    username: "sshUsername",
    authType: "sshAuthType",
    password: "sshPassword",
    privateKey: "sshPrivateKey",
    passphrase: "sshPassphrase",
};

/** SQLite's convention, where the SSH credential overlay writes unprefixed keys. */
export const UNPREFIXED_SSH_KEYS: SshKeyMap = {
    host: "host",
    port: "port",
    username: "username",
    authType: "authType",
    password: "password",
    privateKey: "privateKey",
    passphrase: "passphrase",
};

function str(value: unknown): string | undefined {
    if (typeof value === "string" && value.length > 0) return value;
    return undefined;
}

function num(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

/**
 * Read SSH parameters out of a config using the given key map.
 *
 * Returns null when the mandatory host or username is missing, so callers can
 * decide whether that is a misconfiguration or simply "not SSH".
 */
export function readSshConfig(
    config: Record<string, unknown>,
    keys: SshKeyMap,
    options: { hostFallbackKey?: string } = {},
): SshConnectionConfig | null {
    const host = str(config[keys.host]) ?? (options.hostFallbackKey ? str(config[options.hostFallbackKey]) : undefined);
    const username = str(config[keys.username]);
    if (!host || !username) return null;

    const authType = str(config[keys.authType]);
    return {
        host,
        port: num(config[keys.port]) ?? 22,
        username,
        authType:
            authType === "privateKey" || authType === "agent" || authType === "password"
                ? authType
                : "password",
        password: str(config[keys.password]),
        privateKey: str(config[keys.privateKey]),
        passphrase: str(config[keys.passphrase]),
    };
}

/**
 * The default resolver: `connectionMode` plus prefixed SSH fields.
 *
 * `connectionMode` is treated as direct when absent. That default lives here in
 * code rather than relying on the Zod `.default("direct")`, because
 * resolveAdapterConfig returns decrypted JSON without ever running the schema.
 */
export const standardTransport: TransportResolver = (config) => {
    if (config.connectionMode !== "ssh") {
        return { kind: "direct" };
    }
    const ssh = readSshConfig(config, PREFIXED_SSH_KEYS);
    if (!ssh) {
        throw new Error(
            "Connection mode is set to SSH but the SSH host or username is missing. " +
                "Check the adapter's SSH settings and its assigned SSH credential profile.",
        );
    }
    return { kind: "ssh", ssh };
};

/**
 * A spec whose hosts dial checked addresses for a tenant that blocks the local network: the SSH
 * server, and what a direct host connects to. The policy comes from the resolved config, never
 * from a field of it, so every resolver gets it without reading it, see `reach-policy.ts`.
 */
function withReach(spec: TransportSpec, reach: ReachPolicy | null): TransportSpec {
    if (!reach) return spec;
    switch (spec.kind) {
        case "direct":
            return { ...spec, reach };
        case "ssh":
            return { ...spec, ssh: { ...spec.ssh, reach } };
        case "composite":
            return { ...spec, exec: withReach(spec.exec, reach), files: withReach(spec.files, reach) };
    }
}

/**
 * A spec whose SSH hosts check the host key of their server by the policy of the connection, see
 * `host-key.ts`. Like the reach policy it comes from the resolved config, never from a field of it.
 */
function withHostKey(spec: TransportSpec, hostKey: SshHostKeyPolicy | null): TransportSpec {
    if (!hostKey) return spec;
    switch (spec.kind) {
        case "direct":
            return spec;
        case "ssh":
            return { ...spec, ssh: { ...spec.ssh, hostKey } };
        case "composite":
            return { ...spec, exec: withHostKey(spec.exec, hostKey), files: withHostKey(spec.files, hostKey) };
    }
}

/**
 * Apply an adapter's own resolver, or the standard convention when it has none.
 *
 * Resolution failures are rewrapped so the message names the adapter, which is
 * the difference between a usable error and "cannot read property of null".
 */
export function resolveTransport(
    adapter: { id: string; transport?: TransportResolver },
    config: unknown,
): TransportSpec {
    const resolver = adapter.transport ?? standardTransport;
    try {
        return withHostKey(withReach(resolver((config ?? {}) as Record<string, unknown>), reachOf(config)), hostKeyOf(config));
    } catch (error) {
        throw new ConfigurationError(adapter.id, error instanceof Error ? error.message : String(error), {
            cause: error instanceof Error ? error : undefined,
        });
    }
}

/**
 * The " (via SSH)" suffix used in connection-test messages.
 *
 * A helper rather than an inline `host.kind` check at every call site, so the
 * transport lint guard can treat any remaining kind check as what it is: a real
 * behavioural fork that needs a written justification.
 */
export function transportSuffix(host: { kind: string }): string {
    return host.kind === "ssh" ? " (via SSH)" : "";
}
