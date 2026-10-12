/** Redis and Valkey, which share their client and dataset. Both restore by hand, so their backups are only checked. */

import type { Clients, EngineSpec } from "./types";

const login = { username: "default", password: "testpassword" };

const clients: Clients = { cli: `$(command -v valkey-cli || command -v redis-cli) -a ${login.password} --no-auth-warning` };

const shared = {
    innerPort: 6379,
    login,
    clients,
    dataset: { file: "redis.txt", check: `[ "$(${clients.cli} EXISTS lab:dataset)" = "1" ] && echo yes || true`, load: clients.cli },
    source: (target: { host: string; port: number }) => ({ host: target.host, port: target.port, connectionMode: "direct", mode: "standalone", database: 0 }),
    restores: false,
} satisfies Partial<EngineSpec>;

export const REDIS: EngineSpec = {
    ...shared,
    id: "redis",
    name: "Redis",
    versions: [
        { version: "6", service: "redis-6", port: 63796, profile: "core" },
        { version: "7", service: "redis-7", port: 63797, profile: "full" },
        { version: "8", service: "redis-8", port: 63798, profile: "core" },
    ],
    native: { host: "127.0.0.1", clients: (native) => ({ cli: `redis-cli -a '${native.password}' --no-auth-warning` }) },
};

export const VALKEY: EngineSpec = {
    ...shared,
    id: "valkey",
    name: "Valkey",
    versions: [
        { version: "7.2", service: "valkey-72", port: 63772, profile: "core" },
        { version: "8", service: "valkey-8", port: 63780, profile: "core" },
    ],
};
