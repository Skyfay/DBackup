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
import { permissionRefusal } from "@/lib/server/permission-refusal";
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

    let ids: string[] = [];
    try {
        // Security: exporting master keys is the most sensitive read in the product.
        checkPermissionWithContext(ctx, PERMISSIONS.VAULT.WRITE);

        ids = (request.nextUrl.searchParams.get("ids") ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
        if (ids.length === 0) {
            return new NextResponse("No encryption profiles selected", { status: 400 });
        }

        // The profiles without their keys first, which name the entry. An unknown id ends here
        // with nothing logged and no key read.
        const found: { id: string; name: string }[] = [];
        for (const id of ids) {
            const profile = await encryptionService.getEncryptionProfile(id);
            if (!profile) {
                return new NextResponse(`Encryption profile ${id} not found`, { status: 404 });
            }
            found.push({ id: profile.id, name: profile.name });
        }

        // Logged before a key is decrypted, so a kit is never silent.
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.EXPORT,
            AUDIT_RESOURCES.VAULT,
            { action: VAULT_AUDIT.KIT, name: found.map((profile) => profile.name).join(", "), profileIds: ids },
            ids.length === 1 ? ids[0] : undefined
        );

        const profiles: RecoveryKitProfile[] = [];
        for (const profile of found) {
            profiles.push({ ...profile, masterKeyHex: await encryptionService.getDecryptedMasterKey(profile.id) });
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
        const refused = permissionRefusal(error);
        if (refused) return refused;
        log.error("Recovery kit generation error", { profileIds: ids }, wrapError(error));
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
