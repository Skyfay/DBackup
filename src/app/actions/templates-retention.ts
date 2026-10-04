"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getErrorMessage } from "@/lib/logging/errors";
import { getRetentionTargets } from "@/services/templates/retention-targets";

const ScopeSchema = z.union([z.object({ policyId: z.string().min(1) }), z.object({ followers: z.literal(true) })]);

/**
 * The destinations a change of a retention policy reaches, each with the backups it holds now, so
 * its dialog can say what the next runs remove. `followers` are the destinations a new default
 * would reach. Only counts and times of backups leave the server, never their names.
 */
export async function getRetentionPolicyTargets(scope: { policyId: string } | { followers: true }) {
    await checkPermission(PERMISSIONS.TEMPLATES.READ);

    const parsed = ScopeSchema.safeParse(scope);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        return { success: true as const, data: await getRetentionTargets(parsed.data) };
    } catch (e: unknown) {
        return { success: false as const, error: getErrorMessage(e) };
    }
}
