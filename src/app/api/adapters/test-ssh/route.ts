import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { SshHost, createHost, resolveTransport, type TransportSpec, type SshConnectionConfig } from "@/lib/transport";
import type { DatabaseAdapter } from "@/lib/core/interfaces";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { checkBackupPath, checkBackupPathShared } from "@/lib/adapters/database/mssql/preflight";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { assertConfigOffHost, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { registerAdapters } from "@/lib/adapters";
import { assertMayApplySavedLogin } from "@/lib/auth/saved-login-access";
import { assertMayReadFormConfig } from "@/lib/auth/form-config-access";
import { logger } from "@/lib/logging/logger";
import { PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ route: "adapters/test-ssh" });

/**
 * A non-empty path of bounded length, without control characters.
 *
 * Deliberately does not require a leading slash. SQL Server on Windows takes
 * `C:/Backups`, which the rest of the adapter joins with path.posix and would
 * handle - rejecting it here would narrow what works today for no gain, since
 * the path no longer reaches a command line at all.
 *
 * What is left has no legitimate use in a directory name and is worth refusing
 * at the edge rather than further in. Anchored at both ends around one
 * character class, so it cannot backtrack - the same reason path handling
 * elsewhere uses loops instead of `/\/+$/`.
 */
const VALID_BACKUP_PATH = /^[^\0\n\r]{1,4096}$/;

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { config, adapterId, sshCredentialId } = body as { config: Record<string, any>; adapterId?: string; sshCredentialId?: string | null };

        // The config of a form opens SSH to any host with the login it names, and for SQL Server
        // writes a probe file there. So it is for someone who may change connections of its kind,
        // sources:write for SSH without an adapter, and in one tenant, never All tenants.
        if (adapterId) {
            assertMayReadFormConfig(ctx, adapterId);
        } else {
            checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.WRITE);
            tenantOf(ctx);
        }

        if (!config) {
            return NextResponse.json(
                { success: false, message: "Missing config" },
                { status: 400 }
            );
        }

        // Resolve SSH credential profile if provided. This overlays sshUsername,
        // sshAuthType, sshPassword, sshPrivateKey, and sshPassphrase from the
        // stored credential record onto the config, so callers using a credential
        // profile do not need to include these fields inline.
        let resolvedConfig = { ...config };
        if (adapterId && sshCredentialId) {
            assertMayApplySavedLogin(ctx, adapterId);
            try {
                resolvedConfig = await overlayCredentialsOnConfig(
                    adapterId,
                    resolvedConfig,
                    null,
                    sshCredentialId
                ) as Record<string, any>;
            } catch (overlayError: unknown) {
                // A refusal of the host, like one in the local network of a tenant that may not reach it, says why.
                if (overlayError instanceof ValidationError) {
                    return NextResponse.json({ success: false, message: overlayError.message }, { status: 400 });
                }
                log.warn("Failed to overlay SSH credential", { adapterId, sshCredentialId }, wrapError(overlayError));
                return NextResponse.json(
                    { success: false, message: "Failed to resolve SSH credential profile" },
                    { status: 400 }
                );
            }
        }

        // A customer never logs in with the keys or the agent of the server DBackup runs on.
        try {
            await assertConfigOffHost(adapterId ?? "ssh", { ...resolvedConfig, connectionMode: "ssh" });
        } catch (refusal: unknown) {
            if (refusal instanceof ValidationError) return NextResponse.json({ success: false, message: refusal.message }, { status: 400 });
            throw refusal;
        }

        // Which SSH parameters a config carries is the adapter's own business:
        // SQLite stores mode/host/username where everyone else stores
        // connectionMode/sshHost/sshUsername. Asking the adapter's resolver
        // replaces the hand-rolled field lifting that used to live here.
        const adapter = adapterId ? registry.get(adapterId) : undefined;
        let spec: TransportSpec;
        try {
            spec = resolveTransport(
                { id: adapterId ?? "ssh", transport: (adapter as DatabaseAdapter | undefined)?.transport },
                { ...resolvedConfig, connectionMode: "ssh" },
            );
        } catch (resolveError: unknown) {
            return NextResponse.json(
                { success: false, message: resolveError instanceof Error ? resolveError.message : "Invalid SSH configuration" },
                { status: 400 },
            );
        }

        if (spec.kind !== "ssh") {
            return NextResponse.json(
                { success: false, message: "SSH username is required" },
                { status: 400 },
            );
        }

        const sshHost = spec.ssh.host;
        const sshPort = spec.ssh.port ?? 22;

        // Only SQL Server has a backup directory that both the server and the
        // SSH account have to reach. Testing that here used to key off
        // `connectionMode === "ssh"` alone, which is true for every adapter in
        // SSH mode, so a MySQL or PostgreSQL source was told its SQL Server
        // backup path was missing.
        if (adapterId === "mssql") {
            // `backupPath` is the only value from this request body that ends up
            // in a remote command line, so it is checked here rather than trusted
            // `backupPath` is checked here rather than trusted from the body,
            // so an unusable value is answered with a clear message instead of
            // a confusing failure further in. Kept narrow on purpose: only what
            // cannot name a real directory is refused.
            const backupPath = resolvedConfig.backupPath;
            if (backupPath !== undefined && !VALID_BACKUP_PATH.test(String(backupPath))) {
                return NextResponse.json(
                    { success: false, message: "Backup path must be a non-empty path without control characters." },
                    { status: 400 },
                );
            }
            return testMssqlSsh(resolvedConfig as MSSQLConfig, spec, sshHost, sshPort);
        }

        // Generic SSH connection test for all other adapters
        return testGenericSsh(spec.ssh, sshHost, sshPort);
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, message: error.message }, { status: 403 });
        log.error("SSH test route error", {}, wrapError(error));
        const message =
            error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
            { success: false, message },
            { status: 500 }
        );
    }
}

/**
 * Generic SSH test: connect and run a simple echo command.
 */
async function testGenericSsh(sshConfig: SshConnectionConfig, sshHost: string, sshPort: number) {
    const host = new SshHost(sshConfig);
    try {
        const result = await host.exec(["echo", "connected"]);

        if (result.code === 0) {
            return NextResponse.json({
                success: true,
                message: `SSH connection to ${sshHost}:${sshPort} successful`,
            });
        }

        return NextResponse.json({
            success: false,
            message: `SSH connected but test command failed: ${result.stderr.trim()}`,
        });
    } catch (connectError: unknown) {
        const message = connectError instanceof Error ? connectError.message : "SSH connection failed";
        log.warn("SSH test failed", { sshHost }, wrapError(connectError));
        return NextResponse.json({ success: false, message });
    } finally {
        await host.dispose().catch(() => {});
    }
}

/**
 * MSSQL SSH test: connect and verify the backup directory is usable, since a
 * problem there only surfaces as a missing .bak in the middle of a backup.
 */
async function testMssqlSsh(
    config: MSSQLConfig,
    spec: TransportSpec,
    sshHost: string,
    sshPort: number,
) {
    const backupPath = config.backupPath || "/var/opt/mssql/backup";
    const host = createHost(spec);

    try {
        const result = await checkBackupPath(host, backupPath);

        if (!result.readable) {
            return NextResponse.json({
                success: false,
                message: `SSH connection to ${sshHost}:${sshPort} successful, but backup path is not accessible: ${backupPath}${result.error ? ` (${result.error})` : ""}`,
            });
        }

        if (!result.writable) {
            return NextResponse.json({
                success: false,
                message: `SSH connection to ${sshHost}:${sshPort} successful, but backup path is read-only: ${backupPath}`,
            });
        }

        // Reachable and writable is not the same as "the directory SQL Server
        // writes into". Ask the server itself before reporting success, so a
        // containerized SQL Server with its own copy of this path is caught
        // here rather than halfway through the first backup.
        const shared = await checkBackupPathShared(config, host, backupPath).catch(() => null);

        if (shared && !shared.shared) {
            return NextResponse.json({
                success: false,
                message:
                    `SSH connection to ${sshHost}:${sshPort} successful, and ${backupPath} exists over SSH, ` +
                    `but SQL Server does not see the same directory. This is what happens when SQL Server ` +
                    `runs in a container and ${backupPath} is not bind-mounted to the same path on the host. ` +
                    `Use a path that is identical inside the container and on the host.`,
            });
        }

        const verified = shared ? " and shared with SQL Server" : "";
        return NextResponse.json({
            success: true,
            message: `SSH connection to ${sshHost}:${sshPort} successful - backup path ${backupPath} is readable, writable${verified}`,
        });
    } catch (connectError: unknown) {
        const message = connectError instanceof Error ? connectError.message : "SSH connection failed";
        log.warn("SSH test failed", { sshHost }, wrapError(connectError));
        return NextResponse.json({ success: false, message });
    } finally {
        await host.dispose().catch(() => {});
    }
}
