import readline from "node:readline";
import type { ExecutionHost } from "@/lib/transport";
import type { AzureSQLConfig } from "@/lib/adapters/definitions";
import { AdapterError } from "@/lib/logging/errors";
import { buildConnectionString, describeConnection } from "./connection-string";
import { pinnedServer } from "./pinned-server";
import type { BacpacExporter, ExporterLog } from "./types";

/**
 * BACPAC export and import through Microsoft's SqlPackage.
 *
 * ## The connection string is on argv, and that is a deliberate exception
 *
 * `src/lib/adapters/CLAUDE.md` says secrets go in `options.env`, never in argv.
 * SqlPackage has no environment route and rejects `/SourceConnectionString:@file`
 * (verified against 170.4.83), so the string has to be an argument.
 *
 * The exception holds because of why the rule exists: `SshHost` renders env into
 * an `export` prefix so secrets stay out of the *remote* process table. This
 * adapter has no SSH mode at all, by construction - the schema carries no
 * `connectionMode`, so `standardTransport` always returns a DirectHost. The argv
 * array therefore never touches a shell, and the exposure is the process table of
 * the very container that already holds the password in memory.
 *
 * That bound is structural, not a `host.kind` check, which the transport lint
 * guard forbids for good reason. If an SSH mode is ever added here, this comment
 * stops being true and the secret handling has to be revisited first.
 */

const BINARY = "sqlpackage";

/** Lines SqlPackage prefixes with `***` are warnings or errors, never progress. */
const NOTICE_PREFIX = "***";

/**
 * Ledger tables cannot be captured completely by a BACPAC.
 *
 * SqlPackage says so per element, and the consequence is worth raising rather than
 * leaving in the noise: the history table and the generated-always columns are
 * dropped, which is exactly the tamper evidence Ledger exists to provide. A user
 * who reads this in the run log can still decide what to do. One who finds out
 * during a restore cannot.
 */
function isLedgerNotice(line: string): boolean {
    return line.includes("ledger table") || line.includes("ledger data in system views");
}

/**
 * Run SqlPackage and stream its output into the run log.
 *
 * Uses spawn rather than exec because the interesting part is the narration.
 * SqlPackage reports each table as it processes it, and buffering that until the
 * end would leave a multi-hour export looking hung.
 */
async function run(
    argv: string[],
    host: ExecutionHost,
    log: ExporterLog,
    operation: string,
    onLine?: (line: string) => void,
): Promise<void> {
    const proc = await host.spawn(argv);

    const notices: string[] = [];
    let sawLedgerNotice = false;

    const consume = async (stream: NodeJS.ReadableStream, isStderr: boolean) => {
        for await (const raw of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
            const line = raw.trim();
            if (!line) continue;

            if (line.startsWith(NOTICE_PREFIX)) {
                const text = line.slice(NOTICE_PREFIX.length).trim();
                notices.push(text);

                if (isLedgerNotice(text) && !sawLedgerNotice) {
                    sawLedgerNotice = true;
                    log(
                        "This database uses Ledger tables. A BACPAC cannot capture their history tables or their generated-always columns, so the tamper evidence is not part of this backup.",
                        "warning",
                    );
                }
                log(text, "warning");
                continue;
            }

            log(`SqlPackage: ${line}`, isStderr ? "warning" : "info");
            onLine?.(line);
        }
    };

    await Promise.all([consume(proc.stdout, false), consume(proc.stderr, true)]);
    const { code, signal } = await proc.exit();

    if (code !== 0) {
        // The notices carry the actual cause. The exit code on its own says only
        // that something went wrong, which is what made the old MSSQL failures so
        // hard to read.
        const detail = notices.length > 0 ? notices.join(" | ") : `exit code ${code}${signal ? ` (${signal})` : ""}`;
        throw new AdapterError("azure-sql", operation, detail);
    }
}

export const sqlpackageExporter: BacpacExporter = {
    id: "sqlpackage",

    async probe(_config: AzureSQLConfig, host: ExecutionHost) {
        try {
            const binary = await host.which(BINARY);
            const result = await host.exec([binary, "/version"], { timeoutMs: 30_000 });
            if (result.code !== 0) {
                return { ok: false, detail: `${BINARY} is installed but exited with code ${result.code}` };
            }
            return { ok: true, detail: `SqlPackage ${result.stdout.trim()}` };
        } catch {
            return {
                ok: false,
                // Both halves are needed. The container is the normal case, but a
                // development checkout has no image at all, and blaming one there
                // sends the reader looking for a problem that does not exist.
                detail: `${BINARY} was not found on PATH. It ships with the DBackup container image, so in Docker this points at a custom or outdated image. In a local development setup, run scripts/setup-dev-macos.sh or scripts/setup-dev-debian.sh.`,
            };
        }
    },

    async exportDatabase(config, dbName, destPath, host, log) {
        const binary = await host.which(BINARY);

        // The address SqlPackage dials for a tenant that blocks the local network, checked now.
        const server = await pinnedServer(config);

        log(`Exporting ${describeConnection(config, dbName)}`, "info", "command");

        await run(
            [
                binary,
                "/Action:Export",
                `/TargetFile:${destPath}`,
                "/OverwriteFiles:True",
                `/SourceConnectionString:${buildConnectionString(config, dbName, server)}`,
            ],
            host,
            log,
            "export",
        );
    },

    async importDatabase(config, srcPath, targetDbName, host, log, onProgress) {
        const binary = await host.which(BINARY);

        // The address SqlPackage dials for a tenant that blocks the local network, checked now.
        const server = await pinnedServer(config);

        log(`Importing into ${describeConnection(config, targetDbName)}`, "info", "command");

        // SqlPackage reports no percentage of its own, so these are the phases it
        // does announce, mapped to anchors. Inventing a smooth curve between them
        // would be a guess presented as a measurement.
        const anchors: [string, number][] = [
            ["Initializing deployment", 10],
            ["Importing package schema", 25],
            ["Processing Import", 40],
            ["Enabling indexes", 85],
            ["Successfully imported", 100],
        ];

        await run(
            [
                binary,
                "/Action:Import",
                `/SourceFile:${srcPath}`,
                `/TargetConnectionString:${buildConnectionString(config, targetDbName, server)}`,
            ],
            host,
            log,
            "import",
            (line) => {
                const anchor = anchors.find(([needle]) => line.includes(needle));
                if (anchor) onProgress?.(anchor[1], line);
            },
        );
    },
};
