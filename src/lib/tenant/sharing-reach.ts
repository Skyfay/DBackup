import { reachCovers, type PlatformReach } from "@/lib/auth/platform-group-caps";

/**
 * What `platform-sharing:write` touches for someone of a platform group of some tenants: it gives
 * to, takes from and changes the rules and the backups on demand of the tenants their platform group
 * reaches, and only someone who reaches every tenant shares with all of them. A platform admin and a
 * platform group of all tenants reach every tenant. The services refuse the rest with these words,
 * and the pages lock what they would refuse with the same ones.
 */

export { reachCovers, type PlatformReach };

/** Whether a reach covers every tenant, the ones made later too. */
export const reachesEveryTenant = (reach: PlatformReach): reach is "all" => reach === "all";

/** The sentences of a refusal, each naming what lies beyond the reach. */
export const OUTSIDE_REACH = {
    /** Giving a database or a rule to a tenant. */
    give: (tenant: string) => `Your platform group does not reach ${tenant}, so you cannot give it a database.`,
    /** Taking a database back from its tenant, giving it to another one, moving it or changing its backups on demand. */
    holder: (database: string, tenant: string) => `${database} belongs to ${tenant}, which your platform group does not reach, so you cannot change it.`,
    /** Removing a rule or changing its backups on demand. */
    rule: (pattern: string, tenant: string) => `The rule ${pattern} gives to ${tenant}, which your platform group does not reach, so you cannot change it.`,
    /** A new rule that ranks above the rule that gives a database to such a tenant now. */
    takes: (database: string, tenant: string) => `The rule would take ${database} from ${tenant}, which your platform group does not reach. Give it a lower priority or a narrower pattern.`,
    /** Sharing a destination or a channel with a tenant, or stopping it. */
    share: (tenant: string) => `Your platform group does not reach ${tenant}, so you cannot share with it or stop sharing with it.`,
    /** Deleting the backups of a tenant on a shared destination. */
    backups: (tenant: string) => `Your platform group does not reach ${tenant}, so you cannot delete its backups.`,
    /** Picking All tenants for a destination or a channel. */
    everyTenant: "Your platform group does not reach every tenant, so you cannot share with all tenants.",
    /** Changing or stopping a share with every tenant. */
    sharedWithEvery: (name: string) => `${name} is shared with every tenant. Only someone whose platform group reaches every tenant changes that.`,
    /** Changing the terms of a share that tenants beyond the reach get too. */
    terms: (tenants: readonly string[]) => `The terms hold for ${listOf(tenants)} too, which your platform group does not reach, so you cannot change them.`,
} as const;

/** "Acme", "Acme and Globex", "Acme, Globex and 2 more". */
function listOf(names: readonly string[]): string {
    if (names.length <= 1) return names[0] ?? "other tenants";
    if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
