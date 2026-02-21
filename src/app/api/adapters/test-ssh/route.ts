import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { MssqlSshTransfer } from "@/lib/adapters/database/mssql/ssh-transfer";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "adapters/test-ssh" });

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ);

    try {
        const body = await req.json();
        const { config } = body as { config: MSSQLConfig };

        if (!config) {
            return NextResponse.json(
                { success: false, message: "Missing config" },
                { status: 400 }
            );
        }

        if (!config.sshUsername) {
            return NextResponse.json(
                { success: false, message: "SSH username is required" },
                { status: 400 }
            );
        }

        const sshTransfer = new MssqlSshTransfer();
        const sshHost = config.sshHost || config.host;
        const sshPort = config.sshPort || 22;

        try {
            await sshTransfer.connect(config);

            // Test read/write on backup path if configured
            const backupPath = config.backupPath || "/var/opt/mssql/backup";
            const pathResult = await sshTransfer.testBackupPath(backupPath);

            sshTransfer.end();

            if (!pathResult.readable) {
                return NextResponse.json({
                    success: false,
                    message: `SSH connection to ${sshHost}:${sshPort} successful, but backup path is not accessible: ${backupPath}`,
                });
            }

            if (!pathResult.writable) {
                return NextResponse.json({
                    success: false,
                    message: `SSH connection to ${sshHost}:${sshPort} successful, but backup path is read-only: ${backupPath}`,
                });
            }

            return NextResponse.json({
                success: true,
                message: `SSH connection to ${sshHost}:${sshPort} successful — backup path ${backupPath} is readable and writable`,
            });
        } catch (connectError: unknown) {
            sshTransfer.end();
            const message =
                connectError instanceof Error
                    ? connectError.message
                    : "SSH connection failed";

            log.warn("SSH test failed", { sshHost }, wrapError(connectError));

            return NextResponse.json({
                success: false,
                message,
            });
        }
    } catch (error: unknown) {
        log.error("SSH test route error", {}, wrapError(error));
        const message =
            error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
            { success: false, message },
            { status: 500 }
        );
    }
}
