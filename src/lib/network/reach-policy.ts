import type { CidrRange } from "./local-network";

/**
 * What a connection of a tenant that blocks the local network may still dial: the ranges the
 * platform allows it. Carried on a resolved config for the clients that pin the addresses they
 * dial at connect time, see `reach-check.ts`, and read by them with `reachOf`.
 *
 * Like the fact of `network-fact.ts` the policy sits under a symbol, so no stored config and no
 * config of a form sets or clears it. Unlike that fact it only ever adds a check: a config without
 * it, the one of the home tenant or one that never went through the resolver, dials as before,
 * while the check of the config itself still ran wherever it runs. No Node.js module here, the
 * transport and the connection form both read it.
 */

/** The ranges of the local network a blocking tenant reaches anyway. */
export interface ReachPolicy {
    readonly allowed: readonly CidrRange[];
}

const REACH_POLICY = Symbol("dbackup.reachPolicy");

/** Marks a config with the policy of its tenant, or clears it for a tenant that blocks nothing. Mutates and returns the config. */
export function markReach<T>(config: T, policy: ReachPolicy | null): T {
    if (typeof config === "object" && config !== null) {
        const target = config as Record<symbol, unknown>;
        if (policy) target[REACH_POLICY] = { allowed: [...policy.allowed] };
        else delete target[REACH_POLICY];
    }
    return config;
}

/** The policy a config carries, null when its tenant blocks nothing or nobody marked it. */
export function reachOf(config: unknown): ReachPolicy | null {
    if (typeof config !== "object" || config === null) return null;
    const policy = (config as Record<symbol, unknown>)[REACH_POLICY];
    return policy && typeof policy === "object" ? (policy as ReachPolicy) : null;
}

/** Copies the policy of one config onto another, for an adapter that rebuilds its config through a schema, which drops symbols. */
export function keepReach<T>(from: unknown, to: T): T {
    return markReach(to, reachOf(from));
}
