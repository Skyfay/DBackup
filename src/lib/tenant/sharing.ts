import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The right to share with customers: give the databases of a shared server to them, change the
 * rules, move a database to another server and allow backups on demand, share a destination or a
 * channel and delete the backups of a customer on a shared destination. A right on the platform
 * that only a platform group gives, and a platform admin holds, and only in a tenant with
 * `Tenant.sharesWithCustomers`. Every action, route and page of it reads the right here.
 */
export const SHARE_PERMISSION = PERMISSIONS.PLATFORM.SHARING_WRITE;

/** The right to see what is shared: who holds which database of a shared server, and who gets a destination or a channel. */
export const SEE_SHARING_PERMISSION = PERMISSIONS.PLATFORM.SHARING_READ;

/** The backups a day a customer may start of one database, and what a new switch offers. */
export const ON_DEMAND_MIN = 1;
export const ON_DEMAND_MAX = 24;
export const ON_DEMAND_DEFAULT = 3;

/**
 * What a database given by name or a rule stores for backups on demand: null follows the number the
 * platform sets for the customer (`Tenant.onDemandPerDay`), 0 is none for it, else its own number.
 */
export const ON_DEMAND_OFF = 0;

/** Where the number of a database comes from: the customer, its own, or off for it. */
export type OnDemandSource = "tenant" | "own" | "off";

export function onDemandSource(held: number | null): OnDemandSource {
    if (held === null) return "tenant";
    return held === ON_DEMAND_OFF ? "off" : "own";
}

/**
 * The backups a day the customer may start of a database: its own number, none when it is off, else
 * the number of the customer. Null for none.
 */
export function effectiveOnDemand(held: number | null, tenantPerDay: number | null): number | null {
    if (held === null) return tenantPerDay;
    return held === ON_DEMAND_OFF ? null : held;
}
