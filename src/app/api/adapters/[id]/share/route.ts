import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkAnyPermissionWithContext, checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { connectionShareService, ShareChangeError } from "@/services/sharing/connection-shares";
import { logShareChange } from "@/services/sharing/share-audit";
import { platformGroupService } from "@/services/user/platform-group-service";

const log = logger.child({ route: "adapters/[id]/share" });

const IdSchema = z.string().min(1).max(200);
const BodySchema = z.object({
    /** Every other tenant, the ones made later too. */
    allTenants: z.boolean(),
    /** The tenants that get it while `allTenants` is false. */
    tenantIds: z.array(IdSchema).max(1000),
    /** A destination: a job of a customer writes to it only with a key of its Vault. */
    encryptedOnly: z.boolean().default(false),
    /** An email channel: each customer names its own recipients. */
    ownRecipients: z.boolean().default(true),
    /** A tenant that loses a destination loses its backups on it, which needs this. */
    confirmed: z.boolean().default(false),
});

/**
 * GET /api/adapters/[id]/share
 * Who gets a destination or a notification channel of the tenant of the request, how each uses it,
 * and the tenants the caller may share it with. For `platform-sharing:read` or `:write`, in a
 * session or a key of the tenant of the connection.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        checkAnyPermissionWithContext(ctx, [SEE_SHARING_PERMISSION, SHARE_PERMISSION]);
        // A connection belongs to one tenant, All tenants would find none.
        tenantOf(ctx);
        return NextResponse.json({ success: true, data: await connectionShareService.view(id, await platformGroupService.reachOf(ctx.userId)) });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Reading the sharing of a connection failed", { configId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The sharing could not be read" }, { status: 500 });
    }
}

/**
 * PUT /api/adapters/[id]/share
 * Sets who gets a destination or a channel: every other tenant or the ones named, nobody with an
 * empty list. A tenant that loses a destination loses its backups on it, so without `confirmed`
 * the answer is 409 with what each would lose. Someone of a platform group of some tenants, and
 * their key, shares with and takes from the tenants it reaches only.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    const author = { id: ctx.userId, apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null };
    try {
        checkPermissionWithContext(ctx, SHARE_PERMISSION);
        tenantOf(ctx);
        const parsed = BodySchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        const { confirmed, ...settings } = parsed.data;
        const reach = await platformGroupService.reachOf(ctx.userId);

        if (!confirmed) {
            const before = await connectionShareService.view(id, reach);
            const losing = before.kind === "destination" ? await connectionShareService.losing(id, settings, reach) : [];
            if (losing.length > 0) {
                return NextResponse.json({ success: false, error: "The tenants that lose this destination lose their backups on it. Send confirmed to go on.", data: { losing } }, { status: 409 });
            }
        }
        const result = await connectionShareService.save(id, settings, { confirmed, reach });
        const view = await connectionShareService.view(id);
        await logShareChange(author, id, result, settings, view.uses.map((use) => use.name));
        return NextResponse.json({ success: true, data: { gained: result.gained, lost: result.losses.map((loss) => ({ name: loss.name, backups: loss.backups, jobs: loss.jobs.length })) } });
    } catch (error: unknown) {
        // The tenants that lost it before the storage stopped answering are told all the same.
        if (error instanceof ShareChangeError) await logShareChange(author, id, error.change, { allTenants: false }, []);
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Saving the sharing of a connection failed", { configId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The sharing could not be saved" }, { status: 500 });
    }
}
