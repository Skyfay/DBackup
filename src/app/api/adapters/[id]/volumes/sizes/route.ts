import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, PermissionError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { measureDockerVolumes } from "@/services/storage/docker-volume-service";

registerAdapters();

const log = logger.child({ route: "adapters/[id]/volumes/sizes" });

/**
 * GET /api/adapters/[id]/volumes/sizes
 * The bytes each volume of a Docker connection holds, asked apart from the list because the daemon
 * takes long to measure them.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.READ);
        const { id } = await props.params;
        return NextResponse.json({ success: true, data: { sizes: await measureDockerVolumes(id) } });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
        if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "Docker connection not found" }, { status: 404 });
        log.error("Measuring the Docker volumes failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
