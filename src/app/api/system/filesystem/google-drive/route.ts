import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "system/filesystem/google-drive" });

/**
 * POST /api/system/filesystem/google-drive
 * Browse Google Drive folders for the folder picker.
 *
 * Body: {
 *   credentialId: string, // OAUTH credential profile id
 *   folderId?: string     // Folder to list (undefined = root)
 * }
 *
 * Credentials are resolved server-side from the OAUTH credential profile - they
 * never travel through the client.
 *
 * Returns the same shape as the local/remote filesystem API:
 * { success, data: { currentPath, parentPath, entries: [{ name, type, path }] } }
 *
 * For Google Drive, "path" is the folder ID (not a filesystem path).
 */
export async function POST(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.DESTINATIONS.READ);

        const body = await req.json();
        const { credentialId, folderId } = body;

        if (!credentialId) {
            return NextResponse.json({ success: false, error: "Missing credentialId" }, { status: 400 });
        }

        const config = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
            return NextResponse.json(
                { success: false, error: "Google Drive is not authorized. Please authorize first." },
                { status: 400 }
            );
        }

        const oauth2Client = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret
        );
        oauth2Client.setCredentials({ refresh_token: config.refreshToken });

        const drive = google.drive({ version: "v3", auth: oauth2Client });

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
        log.error("Google Drive folder browse failed", {}, wrapError(err));
        const message = err instanceof Error ? err.message : "Failed to browse Google Drive folders";
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
