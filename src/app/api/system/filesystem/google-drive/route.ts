import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { google, type drive_v3 } from "googleapis";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { assertOffSharedLogins } from "@/services/adapters/shared-login";
import { isDriveFolderId } from "@/lib/adapters/storage/google-drive";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { logProbe, type ProbeActor } from "@/services/adapters/probe-audit";
import { AuthenticationError, PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "system/filesystem/google-drive" });

const BodySchema = z.object({
    credentialId: z.string().min(1).max(64),
    // Goes into a Drive query, so only an ID Google could have made passes, "" for My Drive.
    folderId: z.string().max(256).refine((id) => id === "" || isDriveFolderId(id), "Not a Google Drive folder ID").optional(),
    trail: z.boolean().optional(),
});

/** Deeper than any folder someone picks, so a loop in the parents cannot walk forever. */
const MAX_TRAIL = 64;

/**
 * The folders from the top of My Drive down to `folderId`, walked up by parent. The walk ends at
 * My Drive, or at a folder shared from another drive whose parent the account cannot read.
 */
async function trailOf(drive: drive_v3.Drive, folderId: string): Promise<Array<{ name: string; path: string }>> {
    const top = (await drive.files.get({ fileId: "root", fields: "id" })).data.id;
    const trail: Array<{ name: string; path: string }> = [];
    let id: string | undefined = folderId;
    while (id && id !== "root" && id !== top && trail.length < MAX_TRAIL) {
        const folder: drive_v3.Schema$File | null = await drive.files.get({ fileId: id, fields: "id, name, parents" }).then((res) => res.data, () => null);
        if (!folder) break;
        trail.unshift({ name: folder.name || "Untitled", path: folder.id || id });
        id = folder.parents?.[0];
    }
    return trail;
}

/**
 * POST /api/system/filesystem/google-drive
 * Browse Google Drive folders for the folder picker.
 *
 * Body: {
 *   credentialId: string, // OAUTH credential profile id
 *   folderId?: string,    // Folder to list (undefined = root), only letters, digits, - and _
 *   trail?: boolean       // Return the folders from the top down to folderId instead of listing it
 * }
 *
 * Credentials are resolved server-side from the OAUTH credential profile - they
 * never travel through the client.
 *
 * Returns the same shape as the local/remote filesystem API:
 * { success, data: { currentPath, parentPath, entries: [{ name, type, path }] } }
 * or, with `trail`, { success, data: { trail: [{ name, path }] } }, which is where the picker
 * opens for a connection that holds a folder.
 *
 * For Google Drive, "path" is the folder ID (not a filesystem path).
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
        const { credentialId, folderId, trail } = parsed.data;

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
                { success: false, error: "Google Drive is not authorized. Please authorize first." },
                { status: 400 }
            );
        }

        browsing = { userId: viewer.id, authMethod: "session" };

        const oauth2Client = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret
        );
        oauth2Client.setCredentials({ refresh_token: config.refreshToken });

        const drive = google.drive({ version: "v3", auth: oauth2Client });

        if (trail) {
            const found = await trailOf(drive, folderId || "root");
            await logProbe(browsing, "folder_browse", { adapterId: "google-drive" }, true);
            return NextResponse.json({ success: true, data: { trail: found } });
        }

        const parentId = folderId || "root";

        // List only folders in the current location
        const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

        let allFolders: Array<{ name: string; type: string; path: string }> = [];
        let pageToken: string | undefined;

        do {
            const res = await drive.files.list({
                q: query,
                fields: "nextPageToken, files(id, name)",
                spaces: "drive",
                orderBy: "name",
                pageSize: 100,
                pageToken,
            });

            const folders = (res.data.files || []).map((f) => ({
                name: f.name || "Untitled",
                type: "directory" as const,
                path: f.id!, // Use folder ID as "path" for navigation
            }));

            allFolders = allFolders.concat(folders);
            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);

        // Resolve parent path (go up one level)
        let parentPath: string | null = null;
        if (parentId !== "root") {
            try {
                const parentFile = await drive.files.get({
                    fileId: parentId,
                    fields: "parents",
                });
                if (parentFile.data.parents && parentFile.data.parents.length > 0) {
                    parentPath = parentFile.data.parents[0];
                } else {
                    parentPath = "root";
                }
            } catch {
                parentPath = "root";
            }
        }

        // Get current folder name for display
        let currentName = "My Drive";
        if (parentId !== "root") {
            try {
                const currentFolder = await drive.files.get({
                    fileId: parentId,
                    fields: "name",
                });
                currentName = currentFolder.data.name || parentId;
            } catch {
                currentName = parentId;
            }
        }

        await logProbe(browsing, "folder_browse", { adapterId: "google-drive" }, true);
        return NextResponse.json({
            success: true,
            data: {
                currentPath: parentId,
                currentName,
                parentPath,
                entries: allFolders,
            },
        });
    } catch (err) {
        if (err instanceof AuthenticationError) return unauthorized();
        if (err instanceof PermissionError) return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
        // A saved login this list refuses is the caller's to change, no failure of the drive.
        const refusal = requestRefusal(err);
        if (refusal) return refusal;
        if (browsing) await logProbe(browsing, "folder_browse", { adapterId: "google-drive" }, false);
        log.error("Google Drive folder browse failed", {}, wrapError(err));
        return NextResponse.json(
            { success: false, error: "The Google Drive folders could not be listed. The log of DBackup has the details." },
            { status: 500 }
        );
    }
}
