import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { Dropbox } from "dropbox";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { getDecryptedCredentialData } from "@/services/auth/credential-service";
import type { OAuthData } from "@/lib/core/credentials";
import { cloudFolderPath } from "@/lib/adapters/definitions/shared";
import { logger } from "@/lib/logging/logger";
import { logProbe, type ProbeActor } from "@/services/adapters/probe-audit";
import { AuthenticationError, PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "system/filesystem/dropbox" });

const BodySchema = z.object({
    credentialId: z.string().min(1).max(64),
    folderPath: cloudFolderPath.optional(),
});

/**
 * POST /api/system/filesystem/dropbox
 * Browse Dropbox folders for the folder picker.
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

        const config = (await getDecryptedCredentialData(credentialId, "OAUTH")) as OAuthData;

        if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
            return NextResponse.json(
                { success: false, error: "Dropbox is not authorized. Please authorize first." },
                { status: 400 }
            );
        }

        browsing = { userId: viewer.id, authMethod: "session" };

        // Patched fetch that adds .buffer() for Dropbox SDK compatibility
        // The SDK calls res.buffer() internally which doesn't exist on native fetch
        const dropboxFetch: typeof fetch = async (input, init) => {
            const response = await fetch(input, init);
            if (!("buffer" in response)) {
                (response as any).buffer = async () => {
                    const ab = await response.arrayBuffer();
                    return Buffer.from(ab);
                };
            }
            return response;
        };

        const dbx = new Dropbox({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            refreshToken: config.refreshToken,
            fetch: dropboxFetch,
        });

        // Dropbox uses "" for root, paths must start with /
        const currentPath = folderPath || "";

        // List only folders in the current location
        const allEntries: Array<{ name: string; type: string; path: string }> = [];
        let hasMore = true;
        let cursor: string | undefined;

        // First call
        const result = await dbx.filesListFolder({
            path: currentPath,
            recursive: false,
            include_deleted: false,
            limit: 2000,
        });

        for (const entry of result.result.entries) {
            if (entry[".tag"] === "folder") {
                allEntries.push({
                    name: entry.name,
                    type: "directory",
                    path: entry.path_display || entry.path_lower || `${currentPath}/${entry.name}`,
                });
            }
        }

        hasMore = result.result.has_more;
        cursor = result.result.cursor;

        // Paginate if needed
        while (hasMore && cursor) {
            const cont = await dbx.filesListFolderContinue({ cursor });
            for (const entry of cont.result.entries) {
                if (entry[".tag"] === "folder") {
                    allEntries.push({
                        name: entry.name,
                        type: "directory",
                        path: entry.path_display || entry.path_lower || `${currentPath}/${entry.name}`,
                    });
                }
            }
            hasMore = cont.result.has_more;
            cursor = cont.result.cursor;
        }

        // Sort by name
        allEntries.sort((a, b) => a.name.localeCompare(b.name));

        // Determine parent path
        let parentPath: string | null = null;
        if (currentPath && currentPath !== "") {
            const parts = currentPath.split("/").filter(Boolean);
            if (parts.length > 1) {
                parentPath = "/" + parts.slice(0, -1).join("/");
            } else {
                parentPath = ""; // root
            }
        }

        // Current folder name
        const currentName = currentPath
            ? currentPath.split("/").filter(Boolean).pop() || "Root"
            : "Dropbox (Root)";

        await logProbe(browsing, "folder_browse", { adapterId: "dropbox" }, true);
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
        if (browsing) await logProbe(browsing, "folder_browse", { adapterId: "dropbox" }, false);
        log.error("Dropbox folder browse failed", {}, wrapError(err));
        return NextResponse.json(
            { success: false, error: "The Dropbox folders could not be listed. The log of DBackup has the details." },
            { status: 500 }
        );
    }
}
