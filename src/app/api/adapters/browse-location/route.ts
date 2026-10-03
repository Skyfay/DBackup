import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { locationBrowseOf } from "@/lib/adapters/location-browse";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { getManagePermissionForAdapter } from "@/lib/auth/adapter-permissions";
import { PermissionError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { browseLocation } from "@/services/adapters/location-browse-service";

registerAdapters();

const log = logger.child({ route: "adapters/browse-location" });

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
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    const { adapterId, config, configId, primaryCredentialId, path } = parsed.data;

    const permission = getManagePermissionForAdapter(adapterId);
    if (!permission || !locationBrowseOf(adapterId)) {
        return NextResponse.json({ success: false, error: "This connection cannot browse its folders." }, { status: 400 });
    }

    try {
        checkPermissionWithContext(ctx, permission);
        // The saved secrets of the connection being edited, which only someone who may change it gets.
        const entries = await browseLocation({ adapterId, config, storedConfigId: configId, primaryCredentialId, path });
        return NextResponse.json({ success: true, data: { path, entries } });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.warn("Browsing the folders of a connection failed", { adapterId, path }, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 502 });
    }
}
