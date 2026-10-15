import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The right to give the databases of a shared server to customers, change the rules, move a
 * database to another server and allow backups on demand: Share databases, a right on the platform
 * that only a platform group gives, and a platform admin holds. Every action, route and page of it
 * reads the right here.
 */
export const SHARE_DATABASES_PERMISSION = PERMISSIONS.PLATFORM.SHARING_WRITE;

/** The right to see which tenant holds which database of a shared server, the card Databases and tenants read only. */
export const SEE_SHARED_DATABASES_PERMISSION = PERMISSIONS.PLATFORM.SHARING_READ;

/** The backups a day a customer may start of one database, and what a new switch offers. */
export const ON_DEMAND_MIN = 1;
export const ON_DEMAND_MAX = 24;
export const ON_DEMAND_DEFAULT = 3;
