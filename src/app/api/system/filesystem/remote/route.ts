import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import Client from "ssh2-sftp-client";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ route: "filesystem/remote" });

export async function POST(req: NextRequest) {
    try {
        await checkPermission(PERMISSIONS.SETTINGS.READ);

        const body = await req.json();
        const { config, path: requestedPath = "/" } = body;

        if (!config || !config.host) {
            return NextResponse.json({ success: false, error: "Missing SSH configuration" }, { status: 400 });
        }

        const sftp = new Client();

        try {
            await sftp.connect({
                host: config.host,
                port: config.port || 22,
                username: config.username,
                password: config.password,
                privateKey: config.privateKey,
                passphrase: config.passphrase,
                // Add reasonable timeout
                readyTimeout: 10000,
            });

            // Normalize path for remote system (assuming unix-like for now as ssh usually is)
            // If path is empty, default to user home or root?
            // sftp.list('.') lists current working directory.
            const targetPath = requestedPath === "" ? "." : requestedPath;

            // Get file type (to check if directory)
            let isDir = true;
            try {
                 const type = await sftp.exists(targetPath);
                 if (type === false) {
                     // Path doesn't exist
                     // Try to list root if initial path fails?
                     // Or return error
                     // If it's the initial load ("/") it should exist.
                 } else if (type !== 'd') {
                     isDir = false;
                 }
            } catch (_e) {
                // Ignore exist check error
            }

            if (!isDir) {
                 await sftp.end();
                 return NextResponse.json({ success: false, error: "Not a directory" }, { status: 400 });
            }

            const list = await sftp.list(targetPath);
            await sftp.end();

            // Transform to our UI format
            const entries = list.map(item => ({
                name: item.name,
                type: item.type === 'd' ? 'directory' : 'file',
                // Construct path manually since sftp doesn't return full path
                // We assume unix separators for SSH.
                // Handling trailing slashes to avoid //
                path: targetPath === '/' ? `/${item.name}` : `${targetPath}/${item.name}`
            })).sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === "directory" ? -1 : 1;
            });

            // Resolve parent path
            // Naive parent resolution
            const parentPath = targetPath === '/' ? '/' : targetPath.split('/').slice(0, -1).join('/') || '/';

            return NextResponse.json({
                success: true,
                data: {
                    currentPath: targetPath,
                    parentPath: parentPath,
                    entries: entries
                }
            });

        } catch (sshError: unknown) {
            log.error("SSH browse error", {}, wrapError(sshError));
            // Try to close if open
            try { await sftp.end(); } catch {}
            return NextResponse.json({ success: false, error: getErrorMessage(sshError) || "SSH Connection failed" }, { status: 500 });
        }

    } catch (error: unknown) {
        log.error("API error", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
