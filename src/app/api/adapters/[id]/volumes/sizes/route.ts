import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, checkAnyPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, PermissionError, wrapError } from "@/lib/logging/errors";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { connectionName } from "@/services/adapters/adapter-audit";
import { auditedProbe } from "@/services/adapters/probe-audit";
import { HOST_FOLDER_PICKERS, savedConnectionReachesHost } from "@/services/adapters/location-browse-service";
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
    if (!ctx) return unauthorized();

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.READ);
        const { id } = await props.params;
        // The Docker of the server DBackup runs on only for whoever picks its volumes, see `HOST_FOLDER_PICKERS`.
        if (await savedConnectionReachesHost(id)) checkAnyPermissionWithContext(ctx, HOST_FOLDER_PICKERS);
        // Written once the daemon was asked, whether it answered or not. A connection that is not found writes nothing.
        const target = { adapterId: "docker-volume", record: { id, name: await connectionName(id) } };
        return NextResponse.json({ success: true, data: { sizes: await auditedProbe(ctx, "volume_sizes", target, () => measureDockerVolumes(id)) } });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
        if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "Docker connection not found" }, { status: 404 });
        const refused = requestRefusal(error);
        if (refused) return refused;
        log.error("Measuring the Docker volumes failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The Docker volumes could not be measured. The log of DBackup has the details." }, { status: 500 });
    }
}
