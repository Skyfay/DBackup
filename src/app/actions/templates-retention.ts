"use server";

import { z } from "zod";
import { checkPermission, tenantRefusal } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { getRetentionTargets } from "@/services/templates/retention-targets";

const log = logger.child({ action: "templates-retention" });

/** The answer without the right to see jobs, since the targets name jobs and destinations and the times of their backups. */
const RETENTION_TARGETS_NEED_JOBS = "Seeing which jobs a policy reaches needs the right to see jobs.";

const ScopeSchema = z.union([z.object({ policyId: z.string().min(1).max(200) }), z.object({ followers: z.literal(true) })]);

/**
 * The destinations a change of a retention policy reaches, each with the backups it holds now, so
 * its dialog can say what the next runs remove. `followers` are the destinations a new default
 * would reach. Only counts and times of backups leave the server, never their names. Read in the
 * tenant of the viewer only, never in All tenants. The targets name jobs and destinations, so they
 * need `jobs:read` beside `templates:read`.
 */
export async function getRetentionPolicyTargets(scope: { policyId: string } | { followers: true }) {
    const viewer = await checkPermission(PERMISSIONS.TEMPLATES.READ);
    // A policy belongs to a tenant, so All tenants, which would mix the destinations of every tenant, is refused.
    const refused = tenantRefusal(viewer);
    if (refused) return { success: false as const, error: refused };
    if (!viewer.permissions.includes(PERMISSIONS.JOBS.READ)) return { success: false as const, error: RETENTION_TARGETS_NEED_JOBS };

    const parsed = ScopeSchema.safeParse(scope);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        return { success: true as const, data: await getRetentionTargets(parsed.data) };
    } catch (e: unknown) {
        return { success: false as const, error: userMessage(e, "The destinations of the policy could not be read. The server log has the details.", log, "Failed to read the targets of a retention policy") };
    }
}
