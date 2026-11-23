/**
 * The SSH server a connection logs in to, as plain data: the host and port its SSH clients dial,
 * read the way `spec.ts` and the transport resolvers of the adapters read them. The pin of a host key
 * belongs to this endpoint, see `src/services/adapters/ssh-host-key-service.ts`: it counts only
 * while the connection still dials the host and port it was taken at.
 *
 * - SFTP and rsync: `host` and `port`.
 * - SQLite in SSH mode: `host` and `port`, see `sqlite/transport.ts`.
 * - Everything with `sshFields` in SSH mode: `sshHost` and `sshPort`. SQL Server falls back to the
 *   database host for an empty SSH host and also logs in for its older file transfer over SSH,
 *   see `mssql/transport.ts`.
 *
 * No Node.js module here, the connection form reads it too.
 */

type Config = Record<string, unknown>;

export interface SshEndpoint {
    host: string;
    port: number;
}

/** The name of the switch in every schema with an SSH login, see `verifyHostKeyField`. */
export const VERIFY_HOST_KEY = "verifyHostKey";

/**
 * Whether a connection checks the host key of its SSH server. Zod defaults do not run on a stored
 * config, so a missing value, like the one of a connection saved before the switch existed, is on.
 */
export function verifiesHostKey(config: Config): boolean {
    return config[VERIFY_HOST_KEY] !== false;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim().replace(/^\[|\]$/g, "") : "");

function port(value: unknown): number {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    return Number.isInteger(number) && number > 0 && number <= 65535 ? number : 22;
}

const endpoint = (host: string, portValue: unknown): SshEndpoint | null => (host ? { host, port: port(portValue) } : null);

/** The SSH server a config logs in to, null for a config that opens no SSH login. */
export function sshEndpointOf(adapterId: string, config: Config): SshEndpoint | null {
    if (adapterId === "sftp" || adapterId === "rsync") return endpoint(text(config.host), config.port);
    if (adapterId === "sqlite") return config.mode === "ssh" ? endpoint(text(config.host), config.port) : null;
    if (adapterId === "mssql") {
        const overSsh = config.connectionMode === "ssh" || config.fileTransferMode === "ssh";
        return overSsh ? endpoint(text(config.sshHost) || text(config.host), config.sshPort) : null;
    }
    return config.connectionMode === "ssh" ? endpoint(text(config.sshHost), config.sshPort) : null;
}

/** Whether two endpoints name the same server: the host without regard to case, and the port. */
export function sameEndpoint(a: SshEndpoint | null, b: { host?: unknown; port?: unknown } | null): boolean {
    if (!a || !b || typeof b.host !== "string") return false;
    return a.host.toLowerCase() === b.host.toLowerCase() && a.port === port(b.port);
}
