/**
 * Whether the tenant of a connection blocks the local network, as the resolver found it, carried on
 * the resolved config for the adapters whose tools find a server on their own, like smbclient and
 * rpcclient by a NetBIOS broadcast, which the local network check of a tenant cannot see.
 *
 * The fact sits under a symbol. A stored config and a config a form or the API sends are JSON, which
 * holds no symbol, so nobody switches it on or off through a config, and no schema has to strip it.
 * A spread like `{ ...config, pathPrefix }` keeps it, a copy through JSON or a schema drops it.
 *
 * Fail closed: only a config the resolver marked as one of a tenant that does not block reaches the
 * local network the way the tools find it themselves. A config that never went through the resolver,
 * or lost the mark on the way, counts as one of a tenant that blocks. `resolveAdapterConfig` marks a
 * saved connection with the tenant of its row, `overlayCredentialsOnConfig` a config of a form with
 * the tenant that runs now. No Node.js module here, `smb-address.ts` reads it.
 */

import { markReach, type ReachPolicy } from "@/lib/network/reach-policy";

const LOCAL_NETWORK_OPEN = Symbol("dbackup.localNetworkOpen");

/**
 * Marks a resolved config with whether its tenant blocks the local network, see the top of this
 * module, and with the policy the clients that check their addresses at connect time follow, see
 * `reach-policy.ts`, null for none. Mutates and returns the config.
 */
export function markLocalNetwork<T>(config: T, blocks: boolean, policy: ReachPolicy | null = null): T {
    // A config that is no object carries no mark and counts as one of a tenant that blocks.
    if (typeof config === "object" && config !== null) (config as Record<symbol, unknown>)[LOCAL_NETWORK_OPEN] = !blocks;
    return markReach(config, policy);
}

/** Whether a config counts as one of a tenant that blocks the local network: unless the resolver marked it otherwise. */
export function blocksLocalNetwork(config: unknown): boolean {
    if (typeof config !== "object" || config === null) return true;
    return (config as Record<symbol, unknown>)[LOCAL_NETWORK_OPEN] !== true;
}
