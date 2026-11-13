"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, hasPermissionWithContext, tenantRefusal, type Viewer } from "@/lib/auth/access-control";
import { getWritePermissionForAdapterType, PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { CONNECTION_GONE_ROW } from "@/lib/server/connection-access";
import { configBackupTargetRefusal } from "@/lib/server/config-backup-target-guard";
import { getAdapterType } from "@/services/adapters/adapter-list";
import { acceptHostKey, FINGERPRINT_PATTERN, forgetHostKey } from "@/services/adapters/ssh-host-key-accept";

/**
 * What a person decides about the pinned SSH host key of a connection, from its form: trusting the
 * key the server presents after it changed, and forgetting the pin. Both are changes of the
 * connection, so they need the write right of its kind, work in one tenant and never in All
 * tenants, and leave the destination of the configuration backup to a platform admin. The service
 * writes the audit entry and asks the rule about connections to the server DBackup runs on.
 */

const log = logger.child({ action: "ssh-host-key" });

const IdSchema = z.string().min(1).max(200);
const FingerprintSchema = z.string().regex(FINGERPRINT_PATTERN);

/** Whoever may change connections of some kind. The kind of this one is checked once it is known. */
const ANY_CONNECTION_WRITE = [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE] as const;

/** Why the viewer may not change this connection, null when they may. A missing one and one of a kind they may not change answer alike. */
async function changeRefusal(viewer: Viewer, id: string): Promise<string | null> {
    const outside = tenantRefusal(viewer);
    if (outside) return outside;
    const type = await getAdapterType(id);
    if (!type || !hasPermissionWithContext(viewer, getWritePermissionForAdapterType(type))) return CONNECTION_GONE_ROW;
    // A new key for that destination sends the next configuration backup to whoever presents it.
    return configBackupTargetRefusal({ isPlatformAdmin: viewer.isPlatformAdmin, authMethod: "session" }, { connectionIds: [id] });
}

/**
 * Trusts the host key the SSH server of a connection presents now, when its fingerprint is the one
 * the form showed. DBackup logs in once to read the key and stores it only on a match.
 */
export async function trustSshHostKey(configId: string, fingerprint: string) {
    const viewer = await checkPermission(ANY_CONNECTION_WRITE);
    const id = IdSchema.safeParse(configId);
    const shown = FingerprintSchema.safeParse(fingerprint);
    if (!id.success || !shown.success) return { success: false as const, error: "Invalid request" };
    const refused = await changeRefusal(viewer, id.data);
    if (refused) return { success: false as const, error: refused };
    try {
        const change = await acceptHostKey(id.data, shown.data, { userId: viewer.id });
        revalidatePath("/dashboard/connections");
        return { success: true as const, data: { fingerprint: change.fingerprint, previous: change.previous } };
    } catch (error: unknown) {
        return { success: false as const, error: userMessage(error, "The key could not be trusted. The log of DBackup has the details.", log, "Trusting an SSH host key failed", { configId: id.data }) };
    }
}

/** Forgets the pinned host key of a connection. Its next successful login pins the key it sees. */
export async function forgetSshHostKey(configId: string) {
    const viewer = await checkPermission(ANY_CONNECTION_WRITE);
    const id = IdSchema.safeParse(configId);
    if (!id.success) return { success: false as const, error: "Invalid request" };
    const refused = await changeRefusal(viewer, id.data);
    if (refused) return { success: false as const, error: refused };
    try {
        const change = await forgetHostKey(id.data, { userId: viewer.id });
        revalidatePath("/dashboard/connections");
        return { success: true as const, data: { previous: change.previous } };
    } catch (error: unknown) {
        return { success: false as const, error: userMessage(error, "The key could not be forgotten. The log of DBackup has the details.", log, "Forgetting an SSH host key failed", { configId: id.data }) };
    }
}
