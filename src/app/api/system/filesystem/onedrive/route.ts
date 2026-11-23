import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { Client } from "@microsoft/microsoft-graph-client";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { assertOffSharedLogins } from "@/services/adapters/shared-login";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { cloudFolderPath } from "@/lib/adapters/definitions/shared";
import { logger } from "@/lib/logging/logger";
import { logProbe, type ProbeActor } from "@/services/adapters/probe-audit";
import { AuthenticationError, PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "system/filesystem/onedrive" });

const BodySchema = z.object({
    credentialId: z.string().min(1).max(64),
    folderPath: cloudFolderPath.optional(),
});

// Microsoft OAuth token endpoint
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * POST /api/system/filesystem/onedrive
 * Browse OneDrive folders for the folder picker.
 *
 * Body: {
 *   credentialId: string, // OAUTH credential profile id
 *   folderPath?: string   // Folder to list ("" or undefined = root), without a . or .. part
 * }
 *
 * Credentials are resolved server-side from the OAUTH credential profile - they
 * never travel through the client.
 *
 * Returns the same shape as the local/remote filesystem API:
 * { success, data: { currentPath, currentName, parentPath, entries: [{ name, type, path }] } }
 */
export async function POST(req: NextRequest) {
    // Who browses, once the drive is asked, so the audit log keeps the browse whether it answered or not.
    let browsing: ProbeActor | null = null;
    try {
        // Only the connection form browses a drive by its OAuth profile, so it takes the right to change destinations.
        const viewer = await checkPermission(PERMISSIONS.DESTINATIONS.WRITE);

        const parsed = BodySchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
        }
        const { credentialId, folderPath } = parsed.data;

        // Never with a saved login of the destination of the configuration backup, which would show
        // its folders to someone who may not change it.
        const locked = await savedLoginRefusal({ isPlatformAdmin: viewer.isPlatformAdmin, authMethod: "session" }, credentialId);
        if (locked) return locked;
        // Nor with the saved login of a destination shared with customers: the drive holds their
        // folders, which the view of that destination hides and this list would not.
        await assertOffSharedLogins({ primaryCredentialId: credentialId });

        const config = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
            return NextResponse.json(
                { success: false, error: "OneDrive is not authorized. Please authorize first." },
                { status: 400 }
            );
        }

        browsing = { userId: viewer.id, authMethod: "session" };

        // Get access token using refresh token
        const tokenRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken,
                grant_type: "refresh_token",
                scope: "Files.ReadWrite.All offline_access",
            }),
        });

        if (!tokenRes.ok) {
            await logProbe(browsing, "folder_browse", { adapterId: "onedrive" }, false);
            return NextResponse.json(
                { success: false, error: `Failed to refresh token: ${tokenRes.status}` },
                { status: 401 }
            );
        }

        const tokenData = await tokenRes.json();

        const client = Client.init({
            authProvider: (done) => {
                done(null, tokenData.access_token);
            },
        });

        // Build the API path based on the folder path (avoid regex for user input - ReDoS safe)
        let currentPath = folderPath ?? "";
        while (currentPath.startsWith("/")) currentPath = currentPath.slice(1);
        while (currentPath.endsWith("/")) currentPath = currentPath.slice(0, -1);
        const apiPath = currentPath
            ? `/me/drive/root:/${currentPath}:/children`
            : "/me/drive/root/children";

        // List only folders in the current location
        const allEntries: Array<{ name: string; type: string; path: string }> = [];
        let url: string | null = apiPath;

        while (url) {
            const res = await client.api(url)
                .select("id,name,folder")
                .filter("folder ne null")
                .top(200)
                .orderby("name")
                .get();

            for (const item of res.value || []) {
                if (item.folder) {
                    const itemPath = currentPath
                        ? `${currentPath}/${item.name}`
                        : item.name;
                    allEntries.push({
                        name: item.name,
                        type: "directory",
                        path: itemPath,
                    });
                }
            }

            url = res["@odata.nextLink"] || null;
        }

        // Determine parent path
        let parentPath: string | null = null;
        if (currentPath) {
            const parts = currentPath.split("/").filter(Boolean);
            if (parts.length > 1) {
                parentPath = parts.slice(0, -1).join("/");
            } else {
                parentPath = ""; // root
            }
        }

        // Current folder name
        const currentName = currentPath
            ? currentPath.split("/").filter(Boolean).pop() || "Root"
            : "OneDrive (Root)";

        await logProbe(browsing, "folder_browse", { adapterId: "onedrive" }, true);
        return NextResponse.json({
            success: true,
            data: {
                currentPath,
                currentName,
                parentPath,
                entries: allEntries,
            },
        });
    } catch (err) {
        if (err instanceof AuthenticationError) return unauthorized();
        if (err instanceof PermissionError) return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        // A saved login this list refuses is the caller's to change, no failure of the drive.
        const refusal = requestRefusal(err);
        if (refusal) return refusal;
        if (browsing) await logProbe(browsing, "folder_browse", { adapterId: "onedrive" }, false);
        log.error("OneDrive folder browse failed", {}, wrapError(err));
        return NextResponse.json(
            { success: false, error: "The OneDrive folders could not be listed. The log of DBackup has the details." },
            { status: 500 }
        );
    }
}
