import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext, tenantOf, type AuthContext } from "@/lib/auth/access-control";
import { getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { connectionNotFound, seesConnectionType } from "@/lib/server/connection-access";
import { configBackupTargetResponse } from "@/lib/server/config-backup-target-guard";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { unauthorized } from "@/lib/server/unauthorized";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getAdapterType } from "@/services/adapters/adapter-list";
import { acceptHostKey, FINGERPRINT_PATTERN, forgetHostKey } from "@/services/adapters/ssh-host-key-accept";

const log = logger.child({ route: "adapters/[id]/ssh-host-key" });

const AcceptSchema = z.object({ fingerprint: z.string().regex(FINGERPRINT_PATTERN) });

/** The caller as the audit entry names them, with the API key of the request. */
const actorOf = (ctx: AuthContext) => ({ userId: ctx.userId, apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null });

/**
 * Who may decide about the pinned SSH host key of a connection: whoever may change connections of
 * its type, in its tenant, and for the destination of the configuration backup a platform admin
 * with a session alone. A missing connection and one the caller may not see answer alike.
 */
async function refusal(ctx: AuthContext, id: string): Promise<Response | null> {
    const type = await getAdapterType(id);
    if (!seesConnectionType(ctx, type)) return connectionNotFound();
    checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));
    tenantOf(ctx);
    // A new key for that destination sends the next configuration backup to whoever presents it.
    return configBackupTargetResponse(ctx, { connectionIds: [id] });
}

/**
 * POST /api/adapters/[id]/ssh-host-key
 *
 * Trusts the host key the SSH server of the connection presents now, when its fingerprint is the
 * one in the body, the one the caller was shown. DBackup logs in once to read the key.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    const { id } = await props.params;
    try {
        const refused = await refusal(ctx, id);
        if (refused) return refused;

        const body = AcceptSchema.safeParse(await req.json().catch(() => null));
        if (!body.success) return NextResponse.json({ success: false, error: "Send the fingerprint of the key to trust, like SHA256:..." }, { status: 400 });

        const change = await acceptHostKey(id, body.data.fingerprint, actorOf(ctx));
        return NextResponse.json({ success: true, data: { fingerprint: change.fingerprint, previous: change.previous } });
    } catch (error: unknown) {
        const refused = serviceRefusal(error);
        if (refused) return refused;
        log.error("Trusting an SSH host key failed", { adapterId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The key could not be trusted. The log of DBackup has the details." }, { status: 500 });
    }
}

/**
 * DELETE /api/adapters/[id]/ssh-host-key
 *
 * Forgets the pinned host key of the connection. Its next successful login pins the key it sees.
 */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    const { id } = await props.params;
    try {
        const refused = await refusal(ctx, id);
        if (refused) return refused;

        const change = await forgetHostKey(id, actorOf(ctx));
        return NextResponse.json({ success: true, data: { previous: change.previous } });
    } catch (error: unknown) {
        const refused = serviceRefusal(error);
        if (refused) return refused;
        log.error("Forgetting an SSH host key failed", { adapterId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The key could not be forgotten. The log of DBackup has the details." }, { status: 500 });
    }
}
