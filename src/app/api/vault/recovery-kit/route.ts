import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as encryptionService from "@/services/backup/encryption-service";
import { buildRecoveryKit, RecoveryKitProfile } from "@/services/backup/recovery-kit";
import { auditService } from "@/services/audit-service";
import { VAULT_AUDIT } from "@/services/vault/vault-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { attachmentDisposition } from "@/lib/server/content-disposition";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "vault/recovery-kit" });

/**
 * Builds a Recovery Kit for one or more encryption profiles.
 *
 * `?ids=a,b,c` selects which. Several in one kit is the point: a backup records the profile
 * that encrypted it, so a kit holding every key opens every backup without anyone having to
 * work out which of their kits belongs to which job. The ids are not secret - the keys are,
 * and those are only ever in the response body.
 */
export async function GET(request: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    // Security: exporting master keys is the most sensitive read in the product.
    checkPermissionWithContext(ctx, PERMISSIONS.VAULT.WRITE);

    const ids = (request.nextUrl.searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

    if (ids.length === 0) {
        return new NextResponse("No encryption profiles selected", { status: 400 });
    }

    await auditService.log(
        ctx.userId,
        AUDIT_ACTIONS.EXPORT,
        AUDIT_RESOURCES.VAULT,
        { action: VAULT_AUDIT.KIT, profileIds: ids },
        ids.length === 1 ? ids[0] : undefined
    );

    try {
        const profiles: RecoveryKitProfile[] = [];
        for (const id of ids) {
            const profile = await encryptionService.getEncryptionProfile(id);
            if (!profile) {
                return new NextResponse(`Encryption profile ${id} not found`, { status: 404 });
            }
            profiles.push({
                id: profile.id,
                name: profile.name,
                masterKeyHex: await encryptionService.getDecryptedMasterKey(id),
            });
        }

        const zipBuffer = await buildRecoveryKit({ profiles });
        // Kept on the keys, so the Vault stops warning about a key that was never in a kit. The
        // audit entry above is cleaned after a while, this is not.
        await encryptionService.markRecoveryKit(ids);

        // Named after the profile when there is one, so a folder of kits stays tellable
        // apart. A combined kit says how many it covers instead.
        const filename = profiles.length === 1
            ? `recovery_kit_${profiles[0].name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.zip`
            : `recovery_kit_${profiles.length}_profiles.zip`;

        return new NextResponse(zipBuffer as unknown as BodyInit, {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": attachmentDisposition(filename),
            },
        });
    } catch (error: unknown) {
        log.error("Recovery kit generation error", { profileIds: ids }, wrapError(error));
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
