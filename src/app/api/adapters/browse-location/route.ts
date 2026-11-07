import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { locationBrowseOf } from "@/lib/adapters/location-browse";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { browseLocation } from "@/services/adapters/location-browse-service";
import { auditedProbe } from "@/services/adapters/probe-audit";
import { savedLoginRefusal, storedSecretsRefusal } from "@/lib/server/config-backup-target-guard";

registerAdapters();

const log = logger.child({ route: "adapters/browse-location" });

/** What a browse that failed on the storage answers, the reason goes to the log. */
const BROWSE_FAILED = "The folders could not be listed. Check the address and the login of the connection, the log of DBackup has the details.";

const BodySchema = z.object({
    adapterId: z.string().min(1).max(64),
    config: z.record(z.string(), z.unknown()),
    configId: z.string().min(1).max(64).optional(),
    primaryCredentialId: z.string().min(1).max(64).nullish(),
    path: z.string().max(4096).refine((value) => !value.includes("\0"), "Invalid path").default(""),
});

/**
 * POST /api/adapters/browse-location
 *
 * Lists the folders one level below `path` of a storage connection that is being added or
 * changed, for picking its folder in the connection form. It reaches the server with the config
 * and the login of the form, like a connection test, so it needs the right to change storage
 * connections: the saved ones have their own browse route.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    const { adapterId, config, configId, primaryCredentialId, path } = parsed.data;

    const permission = getManagePermissionForAdapter(adapterId);
    if (!permission || !locationBrowseOf(adapterId)) {
        return NextResponse.json({ success: false, error: "This connection cannot browse its folders." }, { status: 400 });
    }

    try {
        checkPermissionWithContext(ctx, permission);
        // The secrets of the destination of the configuration backup never go to a host of the form.
        const locked = await storedSecretsRefusal(ctx, configId) ?? await savedLoginRefusal(ctx, primaryCredentialId);
        if (locked) return locked;
        // The saved secrets of the connection being edited, which only someone who may change it gets.
        // Written once the browse ran, whether the server answered or not, like the test of a connection.
        const entries = await auditedProbe(ctx, "folder_browse", { adapterId, config }, () =>
            browseLocation({ adapterId, config, storedConfigId: configId, primaryCredentialId, path }));
        return NextResponse.json({ success: true, data: { path, entries } });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        // A shared destination or a connection that reaches the server DBackup runs on, refused before it ran.
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.warn("Browsing the folders of a connection failed", { adapterId, path }, wrapError(error));
        return NextResponse.json({ success: false, error: BROWSE_FAILED }, { status: 502 });
    }
}
