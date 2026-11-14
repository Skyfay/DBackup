import { reachCovers, type PlatformReach } from "@/lib/auth/platform-group-caps";

/**
 * What `platform-sharing:write` touches for someone of a platform group of some tenants: it gives
 * to, takes from and changes the rules and the backups on demand of the tenants their platform group
 * reaches, and only someone who reaches every tenant shares with all of them. A platform admin and a
 * platform group of all tenants reach every tenant. The services refuse the rest with these words,
 * and the pages lock what they would refuse with the same ones.
 */

export { reachCovers, type PlatformReach };

/**
 * What a tenant beyond the reach goes by wherever the viewer would see who holds or gets something:
 * no id and no name of its own, so it reads like a tenant they never heard of. Every such tenant
 * shares this one id.
 */
export const TENANT_BEYOND_REACH = { id: "beyond-reach", name: "Another tenant" } as const;

/** The sentences of a refusal. None names a tenant beyond the reach, which reads as gone. */
export const OUTSIDE_REACH = {
    /** Giving a database or a rule to a tenant. */
    give: "Your platform group does not reach this tenant, so you cannot give it a database.",
    /** Taking a database back from its tenant, giving it to another one, moving it or changing its backups on demand. */
    holder: (database: string) => `${database} belongs to a tenant your platform group does not reach, so you cannot change it.`,
    /** Removing a rule or changing its backups on demand. */
    rule: (pattern: string) => `The rule ${pattern} gives to a tenant your platform group does not reach, so you cannot change it.`,
    /** Ending a rule whose database would fall to a lower rule of such a tenant. */
    ruleEnd: (pattern: string, database: string) => `Ending the rule ${pattern} would give ${database} to a tenant your platform group does not reach, so you cannot end it.`,
    /** Ending a rule above a lower rule of such a tenant that can match the same names, also ones the server gets later. */
    ruleEndFalls: (pattern: string) => `Ending the rule ${pattern} would leave its databases to a rule of a tenant your platform group does not reach, so you cannot end it.`,
    /** A new rule that ranks above a rule of such a tenant that can match the same names. */
    takesRule: "The rule would rank above a rule of a tenant your platform group does not reach that can match the same databases. Give it a lower priority or a narrower pattern.",
    /** A new rule that ranks above the rule that gives a database to such a tenant now. */
    takes: (database: string) => `The rule would take ${database} from a tenant your platform group does not reach. Give it a lower priority or a narrower pattern.`,
    /** Sharing a destination or a channel with a tenant, or stopping it. */
    share: "Your platform group does not reach this tenant, so you cannot share with it or stop sharing with it.",
    /** Deleting the backups of a tenant on a shared destination. */
    backups: "Your platform group does not reach this tenant, so you cannot delete its backups.",
    /** Letting a database or a rule follow its customer again, on a server of a tenant beyond the reach. */
    provider: (server: string) => `${server} belongs to a tenant your platform group does not reach, so you cannot change what it gives.`,
    /** Picking All tenants for a destination or a channel. */
    everyTenant: "Your platform group does not reach every tenant, so you cannot share with all tenants.",
    /** Changing or stopping a share with every tenant. */
    sharedWithEvery: (name: string) => `${name} is shared with every tenant. Only someone whose platform group reaches every tenant changes that.`,
    /** Changing the terms of a share that tenants beyond the reach get too. */
    terms: "The terms hold for tenants your platform group does not reach too, so you cannot change them.",
} as const;
