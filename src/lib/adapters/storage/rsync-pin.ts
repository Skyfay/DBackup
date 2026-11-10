import type { StorageAdapter } from "@/lib/core/interfaces";
import { reachableAddress } from "@/lib/network/checked-socket";
import { reachOf } from "@/lib/network/reach-policy";

/**
 * The address rsync and ssh dial for a connection of a tenant that blocks the local network: the
 * one the check resolved right before the call, see `reach-check.ts`, so a name that answers
 * otherwise for ssh reaches no address of the local network either. ssh checks no host key here,
 * see `SSH_HOST_KEY_OPTIONS` in `rsync.ts`, so dialing the address instead of the name changes
 * nothing else. A connection of any other tenant dials its host as before.
 */

/**
 * The field that carries the checked address, without brackets, read by `sshTarget` in `rsync.ts`,
 * which puts an IPv6 address in brackets only inside rsync's `user@[address]:path`.
 */
export interface DialAddress {
    dialAddress?: string;
}

/**
 * The config with the checked address of its host, the first that answers on the SSH port where it
 * has several, see `checked-socket.ts`. The config itself where its tenant blocks nothing.
 */
export async function pinRsyncHost<T extends { host: string; port?: unknown }>(config: T): Promise<T & DialAddress> {
    const reach = reachOf(config);
    if (!reach) return config;
    const host = String(config.host ?? "").trim().replace(/^\[|\]$/g, "");
    return { ...config, dialAddress: await reachableAddress(host, Number(config.port) || 22, reach.allowed) };
}

/** The methods that answer a refusal with a result instead of throwing it. */
const ANSWERS = new Set(["test", "ping"]);

/**
 * The adapter with every method that takes a config first handed the config of `pinRsyncHost`.
 * A refused host fails `test` and `ping` with its message, like any other failed connection.
 */
export function withPinnedRsyncHost(adapter: StorageAdapter): StorageAdapter {
    const pinned: Record<string, unknown> = { ...adapter };
    for (const [name, value] of Object.entries(adapter)) {
        if (typeof value !== "function") continue;
        const method = value as (config: { host: string }, ...rest: unknown[]) => Promise<unknown>;
        pinned[name] = async (config: { host: string }, ...rest: unknown[]) => {
            let ready: { host: string };
            try {
                ready = await pinRsyncHost(config);
            } catch (error: unknown) {
                if (ANSWERS.has(name)) return { success: false, message: error instanceof Error ? error.message : String(error) };
                throw error;
            }
            return method.call(pinned, ready, ...rest);
        };
    }
    return pinned as unknown as StorageAdapter;
}
