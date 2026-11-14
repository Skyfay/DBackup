/**
 * A destination a tenant shares with customers keeps their backups under `tenants/<id>/` of its
 * folder, which the view of its own tenant hides, see `storage-view.ts`. The saved login of such a
 * destination opens that folder for whoever signs in with it, under any spelling of the address and
 * through any kind of connection or form. So it signs in on that destination alone: no other
 * connection gets it, no form applies it, and a destination is not shared while another connection
 * uses its login. `shared-place.ts` compares the places, this compares the logins.
 */

import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { ValidationError } from "@/lib/logging/errors";

/** The saved logins a connection or a form is used with. */
export interface NamedLogins {
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
}

/** Why a saved login of a destination shared with customers signs in nowhere else. */
export const SHARED_LOGIN_REFUSAL = "This saved login signs in to a destination shared with customers, whose backups lie there, so it is used on that destination alone. Pick a saved login of its own.";

const idsOf = (logins: NamedLogins): string[] =>
    [logins.primaryCredentialId, logins.sshCredentialId].filter((id): id is string => typeof id === "string" && id.length > 0);

/**
 * Refuses saved logins that a destination of the tenant that runs now, shared with customers, signs
 * in with. `heldBy` names the saved connection that is being changed: the logins it holds already
 * stay with it, the shared destination itself and a connection saved before the destination was
 * shared alike. A form that lists folders passes none, since its address is the caller's to choose.
 *
 * @throws ValidationError without the name of the destination.
 */
export async function assertOffSharedLogins(logins: NamedLogins, heldBy?: string): Promise<void> {
    let named = idsOf(logins);
    if (named.length === 0) return;
    if (heldBy) {
        const row = await prisma.adapterConfig.findUnique({ where: { id: heldBy }, select: { primaryCredentialId: true, sshCredentialId: true } });
        const held = row ? idsOf(row) : [];
        named = named.filter((id) => !held.includes(id));
        if (named.length === 0) return;
    }
    // The shares of the tenant that runs now, the filter of its scope keeps those of others out.
    const share = await prisma.connectionShare.findFirst({
        where: {
            ...(heldBy ? { id: { not: heldBy } } : {}),
            config: {
                type: "storage",
                storageRole: STORAGE_ROLES.DESTINATION,
                OR: [{ primaryCredentialId: { in: named } }, { sshCredentialId: { in: named } }],
            },
        },
        select: { id: true },
    });
    if (share) throw new ValidationError(SHARED_LOGIN_REFUSAL, { field: "credential" });
}

/**
 * Refuses to share a destination, or to give a shared one other logins, while another connection of
 * the tenant that runs now signs in with one of them, of any kind, since a database in SSH mode
 * reads the files of a server as well.
 *
 * @throws ValidationError naming the other connection.
 */
export async function assertSharedLoginsAlone(destination: { id: string; name: string } & NamedLogins): Promise<void> {
    const named = idsOf(destination);
    if (named.length === 0) return;
    const other = await prisma.adapterConfig.findFirst({
        where: { id: { not: destination.id }, OR: [{ primaryCredentialId: { in: named } }, { sshCredentialId: { in: named } }] },
        select: { name: true },
    });
    if (other) {
        throw new ValidationError(`${other.name} signs in with a saved login of ${destination.name}, which would open the folder of its customers. Give it a saved login of its own before you share ${destination.name}.`);
    }
}
