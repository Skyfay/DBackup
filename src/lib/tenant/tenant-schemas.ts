import { z } from "zod";
import { MAX_ALLOWED_RANGES, MAX_RANGE_LENGTH } from "@/lib/network/local-network";
import { ON_DEMAND_MAX, ON_DEMAND_MIN, ON_DEMAND_OFF } from "@/lib/tenant/sharing";

/**
 * What the platform sends about a tenant, checked the same way for the Server Actions of
 * Platform > Tenants and for `/api/tenants`.
 */

export const TenantNameSchema = z.string().trim().min(1, "Give the tenant a name.").max(60, "The name can have at most 60 characters.");

/** What a tenant adds itself, any of them. */
export const AllowancesSchema = z.object({
    databases: z.boolean(),
    directorySources: z.boolean(),
    destinations: z.boolean(),
    channels: z.boolean(),
    apiKeys: z.boolean(),
}).partial();

/** Whether its connections reach the local network, and the ranges they reach anyway. */
export const NetworkSchema = z.object({
    blocks: z.boolean(),
    allowed: z.array(z.string().max(MAX_RANGE_LENGTH)).max(MAX_ALLOWED_RANGES, `A tenant has at most ${MAX_ALLOWED_RANGES} allowed ranges. Allow a wider range instead.`),
});

/** How many backups a day a customer may start of every database given to it, none with null. */
export const OnDemandPerDaySchema = z.coerce.number().int().min(ON_DEMAND_MIN).max(ON_DEMAND_MAX).nullable();

/** Backups on demand of a database given by name or by a rule: null follows the customer, 0 is none for it, else a number a day of its own. */
export const AssignmentPerDaySchema = z.coerce.number().int().min(ON_DEMAND_OFF).max(ON_DEMAND_MAX).nullable()
    .refine((value) => value === null || value === ON_DEMAND_OFF || value >= ON_DEMAND_MIN, `Allow from ${ON_DEMAND_MIN} to ${ON_DEMAND_MAX} backups a day.`);

/** A rule that gives the databases of a shared server whose name matches a pattern to a customer. */
export const AssignmentRuleSchema = z.object({
    pattern: z.string().trim().min(1, "Enter a pattern, like shop_*.").max(100),
    tenantId: z.string().min(1).max(200),
    priority: z.coerce.number().int().min(-1000).max(1000).default(0),
    validFrom: z.coerce.date().optional(),
    onDemandPerDay: AssignmentPerDaySchema.optional(),
});
