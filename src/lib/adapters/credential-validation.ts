import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { ValidationError, NotFoundError } from "@/lib/logging/errors";
import type { CredentialType } from "@/lib/core/credentials";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import { rsyncUsernameProblem } from "@/lib/adapters/storage/rsync-user";

/**
 * Validates that a credential profile exists and matches the expected type.
 * Returns the (sanitized) profile on success, or throws.
 */
async function ensureProfileMatchesType(
    profileId: string,
    expected: CredentialType,
    slot: "primary" | "ssh"
): Promise<void> {
    const profile = await prisma.credentialProfile.findUnique({
        where: { id: profileId },
        select: { id: true, type: true },
    });
    if (!profile) {
        throw new NotFoundError("CredentialProfile", profileId);
    }
    if (profile.type !== expected) {
        throw new ValidationError(
            `Credential profile type mismatch for ${slot} slot: expected ${expected}, got ${profile.type}.`,
            { field: slot === "primary" ? "primaryCredentialId" : "sshCredentialId" }
        );
    }
}

/**
 * Validates incoming credential ID assignments against the adapter's declared
 * `credentials` requirements:
 * - rejects assignments to slots the adapter does not declare
 * - enforces type compatibility (e.g. an SSH_KEY profile in an ACCESS_KEY slot
 *   is rejected)
 *
 * Does NOT enforce that a primary credential is assigned at create/update
 * time - the startup-checks layer flags adapters without one as `OFFLINE`,
 * keeping the API tolerant for partial/staged setups.
 */
export async function validateCredentialAssignments(
    adapterId: string,
    primaryCredentialId: string | null | undefined,
    sshCredentialId: string | null | undefined
): Promise<void> {
    const adapter = registry.get(adapterId);
    if (!adapter) {
        throw new ValidationError(`Unknown adapter: ${adapterId}`, { field: "adapterId" });
    }

    const requirements = adapter.credentials;

    if (primaryCredentialId) {
        if (!requirements?.primary) {
            throw new ValidationError(
                `Adapter ${adapterId} does not accept a primary credential profile.`,
                { field: "primaryCredentialId" }
            );
        }
        await ensureProfileMatchesType(primaryCredentialId, requirements.primary, "primary");
        // rsync puts the username of its login in front of the host, so it must be a plain name.
        if (adapterId === "rsync") {
            const data = await getDecryptedCredentialData(primaryCredentialId);
            const problem = rsyncUsernameProblem((data as { username?: unknown }).username);
            if (problem) throw new ValidationError(problem, { field: "primaryCredentialId" });
        }
    }

    if (sshCredentialId) {
        if (!requirements?.ssh) {
            throw new ValidationError(
                `Adapter ${adapterId} does not accept an SSH credential profile.`,
                { field: "sshCredentialId" }
            );
        }
        await ensureProfileMatchesType(sshCredentialId, requirements.ssh, "ssh");
    }
}
