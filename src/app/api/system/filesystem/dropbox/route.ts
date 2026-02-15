import { NextRequest, NextResponse } from "next/server";
import { Dropbox } from "dropbox";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "system/filesystem/dropbox" });

/**
 * POST /api/system/filesystem/dropbox
 * Browse Dropbox folders for the folder picker.
 *
 * Body: {
 *   config: { clientId, clientSecret, refreshToken },
 *   folderPath?: string  // Folder to list ("" or undefined = root)
 * }
 *
 * Returns the same shape as the local/remote filesystem API:
 * { success, data: { currentPath, currentName, parentPath, entries: [{ name, type, path }] } }
 */
export async function POST(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.SETTINGS.READ);

        const body = await req.json();
        const { config, folderPath } = body;

        if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
            return NextResponse.json(
                { success: false, error: "Dropbox is not authorized. Please authorize first." },
                { status: 400 }
            );
        }

        const dbx = new Dropbox({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            refreshToken: config.refreshToken,
            fetch: fetch,
        });

        // Dropbox uses "" for root, paths must start with /
        const currentPath = folderPath || "";

        // List only folders in the current location
        let allEntries: Array<{ name: string; type: string; path: string }> = [];
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
        log.error("Dropbox folder browse failed", {}, wrapError(err));
        const message = err instanceof Error ? err.message : "Failed to browse Dropbox folders";
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
