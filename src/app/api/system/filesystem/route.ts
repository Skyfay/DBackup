import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "system/filesystem" });

export async function GET(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.SETTINGS.READ);

        const searchParams = req.nextUrl.searchParams;
        const requestedPath = searchParams.get("path") || "/";
        const _type = searchParams.get("type") || "all"; // 'all', 'file', 'directory'

        // Basic security check: prevent escaping usage if running in restricted mode (not implementing full jail for now as root access is assumed for self-hosted, but good practice)
        // For now, we allow full system access as this is a system admin tool.

        // Normalize path
        const currentPath = path.resolve(requestedPath);

        let stats;
        try {
            stats = await fs.stat(currentPath);
        } catch (_e) {
            return NextResponse.json({ success: false, error: "Path not found" }, { status: 404 });
        }

        if (!stats.isDirectory()) {
             return NextResponse.json({ success: false, error: "Not a directory" }, { status: 400 });
        }

        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        const content = entries.map(entry => {
            return {
                name: entry.name,
                type: entry.isDirectory() ? "directory" : "file",
                path: path.join(currentPath, entry.name)
            };
        }).sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === "directory" ? -1 : 1;
        });

        // Filter based on type request if needed, but usually UI handles visibility
        // If type === 'directory', we might still want to see files but disabled?
        // Let's just return everything and let UI decide.

        return NextResponse.json({
            success: true,
            data: {
                currentPath,
                parentPath: path.dirname(currentPath),
                entries: content
            }
        });

    } catch (error: unknown) {
        log.error("Filesystem API error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to list directory" }, { status: 500 });
    }
}
