/**
 * Lint guards for the transport layer.
 *
 * Adapters describe WHAT runs, an ExecutionHost decides HOW. Before the
 * extraction there were 37 transport forks across 20 adapter files, every fix
 * had to be made twice, and shellEscape was called from 18 of them. These rules
 * keep that from growing back.
 *
 * Run with: pnpm test tests/unit/lint-guards/adapter-transport.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(__dirname, "../../../src");
const ADAPTERS_DIR = path.join(SRC_DIR, "lib/adapters");
const TRANSPORT_DIR = path.join(SRC_DIR, "lib/transport");

interface Rule {
    name: string;
    pattern: RegExp;
    /** Repo-relative paths exempt from this rule, each with a written reason. */
    allowed?: Record<string, string>;
    /**
     * Restrict the rule to paths starting with this prefix.
     *
     * Opening a connection and running a process are what a storage adapter is
     * FOR - basic-ftp's client, ssh2-sftp-client, the local VSS helper. Only
     * database adapters have an execution host to route through.
     */
    scope?: string;
    reason: string;
}

/**
 * Rules scanned across src/lib/adapters/**.
 *
 * Every allow-list entry carries the justification inline, so a future reader
 * can tell a deliberate exception from an unreviewed one.
 */
const ADAPTER_RULES: Rule[] = [
    {
        name: "isSSHMode",
        pattern: /\bisSSHMode\b/,
        reason: "Transport is resolved once by a TransportResolver, not re-derived per call site.",
    },
    {
        name: "direct ssh2 client",
        pattern: /new\s+SshClient\b|new\s+Client\s*\(/,
        scope: "database/",
        reason: "Database adapters never open connections. The host owns the connection lifecycle.",
    },
    {
        name: "ssh2 import",
        pattern: /from\s+["']ssh2["']/,
        allowed: {
            "storage/sftp.ts": "Uses ssh2-sftp-client as a storage destination, not as an execution transport.",
            "storage/rsync.ts": "Uses ssh2-sftp-client as a storage destination, not as an execution transport.",
        },
        reason: "Only src/lib/transport/** may talk to ssh2 directly.",
    },
    {
        name: "legacy @/lib/ssh import",
        pattern: /from\s+["']@\/lib\/ssh/,
        reason: "src/lib/ssh was removed. Import from @/lib/transport instead.",
    },
    {
        name: "dockerode import",
        pattern: /from\s+["']dockerode["']/,
        allowed: {
            "storage/docker/engine/dockerode-engine.ts":
                "The one implementation of the DockerEngine port. Everything above it speaks volumes and containers, not dockerode.",
        },
        reason:
            "Only storage/docker/engine/dockerode-engine.ts may talk to dockerode. Without this line the client "
            + "spreads back across the adapter within a couple of changes, which is exactly how shellEscape ended up "
            + "in eighteen files.",
    },
    {
        name: "AutoRemove on a container we wait for",
        pattern: /AutoRemove/,
        reason:
            "A container started with AutoRemove is deleted by the daemon the moment it exits, so a "
            + "`wait` that arrives afterwards gets 'no such container'. On a local socket that gap is "
            + "microseconds and it almost always wins; over SSH without socket forwarding every API "
            + "call is its own process on the target and the wait loses every time - reproduced at 0 of "
            + "3 with 400 ms per request. Create, start, wait, then remove it yourself.",
    },
    {
        name: "Dockerode type outside the engine",
        pattern: /\bDockerode\b/,
        allowed: {
            "storage/docker/engine/dockerode-engine.ts": "Constructs the client, so it names its type.",
        },
        reason:
            "A port that leaks the library's own types into signatures is not a port. If DockerEngine ever "
            + "collapses into an alias for Dockerode it should be deleted rather than kept for the shape of it.",
    },
    {
        name: "connectionMode comparison",
        pattern: /connectionMode\s*[=!]==|\.mode\s*===\s*["']ssh["']/,
        allowed: {
            "database/mssql/transport.ts": "The TransportResolver itself. This is where the decision belongs.",
            "database/sqlite/transport.ts": "The TransportResolver itself. This is where the decision belongs.",
            "connection-summary.ts":
                "Not an adapter. It writes the address shown in the connection tables, which names the jump host of an "
                + "SSH connection, and decides no transport.",
        },
        reason: "Transport decisions belong in a TransportResolver, not in adapter bodies.",
    },
    {
        name: "host.kind branch",
        pattern: /host\.kind\s*===/,
        allowed: {
            "database/mongodb/meta/index.ts":
                "mongosh is not in the Dockerfile so direct mode cannot use it, and this PR adds no Mongo " +
                "tunnel so SSH mode cannot use the driver. A real capability difference, not a transport fork.",
            "database/mysql/args.ts":
                "MySQL only forces TCP in direct mode. Over SSH the client is local to the server and the " +
                "socket path is the documented setup (docs/user-guide/sources/mysql.md).",
        },
        reason: "A kind check is a transport fork wearing a new hat. Use a host primitive instead.",
    },
    {
        name: "raw ConnectionPool",
        pattern: /new\s+sql\.ConnectionPool/,
        allowed: {
            "database/mssql/pool.ts": "withPool() is the single wiring point that applies the SSH tunnel.",
            "database/azure-sql/pool.ts": "Its own withPool(), forked rather than shared so a change to the MSSQL tunnelling cannot silently alter it, and so encryption stays pinned on.",
        },
        reason: "Bypassing withPool() skips the tunnel and silently connects to the wrong machine.",
    },
    {
        name: "direct process spawn",
        pattern: /(?<![.\w])(spawn|execFile|exec)\s*\(/,
        scope: "database/",
        allowed: {
            "database/common/tar-utils.ts": "Operates on local archive files in the DBackup container, never on a source host.",
        },
        reason: "Database adapters run commands through host.spawn / host.exec.",
    },
    {
        name: "shellEscape in adapters",
        pattern: /\bshellEscape\b/,
        reason: "Escaping is an implementation detail of SshHost. Adapters pass argv arrays.",
    },
];

/**
 * Rule 9: a host passed to an adapter must be resolved from that adapter's config.
 *
 * Making `host` required already turned "forgot to pass one" into a compile
 * error, so what is left is passing the WRONG one. A hardcoded direct host at
 * one of these call sites would health-check an SSH source against the DBackup
 * container itself and report it ONLINE.
 */
const HARDCODED_HOST = /new\s+DirectHost\s*\(|createHost\s*\(\s*\{\s*kind:\s*["']direct["']/;

interface Violation {
    file: string;
    line: number;
    content: string;
    rule: string;
}

function findFiles(dir: string, exclude: string[] = []): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (exclude.includes(entry.name)) continue;
            results.push(...findFiles(full, exclude));
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Strip comments and string literals before matching.
 *
 * Without this a rule fires on its own name in a doc comment, and on the
 * explanatory prose the adapters carry about why a fork no longer exists.
 */
function stripNonCode(source: string): string[] {
    const lines = source.split("\n");
    let inBlockComment = false;

    return lines.map((line) => {
        let out = "";
        let i = 0;
        while (i < line.length) {
            if (inBlockComment) {
                if (line.startsWith("*/", i)) {
                    inBlockComment = false;
                    i += 2;
                } else {
                    i++;
                }
                continue;
            }
            if (line.startsWith("/*", i)) {
                inBlockComment = true;
                i += 2;
                continue;
            }
            if (line.startsWith("//", i)) break;

            const quote = line[i];
            if (quote === '"' || quote === "'" || quote === "`") {
                // Keep the quotes so import-source rules still match, drop the body.
                out += quote;
                i++;
                while (i < line.length) {
                    if (line[i] === "\\") { i += 2; continue; }
                    if (line[i] === quote) break;
                    out += line[i];
                    i++;
                }
                out += quote;
                i++;
                continue;
            }
            out += line[i];
            i++;
        }
        return out;
    });
}

function scan(files: string[], baseDir: string, rules: Rule[]): Violation[] {
    const violations: Violation[] = [];

    for (const file of files) {
        const relative = path.relative(baseDir, file);
        const lines = stripNonCode(fs.readFileSync(file, "utf8"));

        for (const rule of rules) {
            if (rule.allowed?.[relative]) continue;
            if (rule.scope && !relative.startsWith(rule.scope)) continue;
            lines.forEach((line, index) => {
                if (rule.pattern.test(line)) {
                    violations.push({ file: relative, line: index + 1, content: line.trim(), rule: rule.name });
                }
            });
        }
    }
    return violations;
}

function formatViolationReport(violations: Violation[], rules: Rule[]): string {
    const byRule = new Map<string, Violation[]>();
    for (const v of violations) {
        byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
    }

    const blocks = [...byRule.entries()].map(([name, found]) => {
        const reason = rules.find((r) => r.name === name)?.reason ?? "";
        const rows = found.map((v) => `    ${v.file}:${v.line}  ${v.content}`).join("\n");
        return `  [${name}] ${reason}\n${rows}`;
    });

    return `\n\nFound ${violations.length} transport violation(s):\n\n${blocks.join("\n\n")}\n`;
}

describe("transport lint guards", () => {
    const adapterFiles = findFiles(ADAPTERS_DIR);

    it("keeps transport decisions out of adapter bodies", () => {
        const violations = scan(adapterFiles, ADAPTERS_DIR, ADAPTER_RULES);
        expect(violations, formatViolationReport(violations, ADAPTER_RULES)).toEqual([]);
    });

    it("has no stale allow-list entries", () => {
        // An exemption for a file that no longer exists hides the fact that the
        // rule is now unconditional, and quietly re-opens if the file returns.
        const stale: string[] = [];
        for (const rule of ADAPTER_RULES) {
            for (const relative of Object.keys(rule.allowed ?? {})) {
                if (!fs.existsSync(path.join(ADAPTERS_DIR, relative))) {
                    stale.push(`[${rule.name}] ${relative}`);
                }
            }
        }
        expect(stale, `Stale allow-list entries:\n  ${stale.join("\n  ")}`).toEqual([]);
    });

    it("resolves every adapter host from its config", () => {
        const files = [
            ...findFiles(path.join(SRC_DIR, "services")),
            ...findFiles(path.join(SRC_DIR, "app/api")),
            ...findFiles(path.join(SRC_DIR, "lib/runner")),
            ...findFiles(ADAPTERS_DIR),
        ];

        const violations: Violation[] = [];
        for (const file of files) {
            const lines = stripNonCode(fs.readFileSync(file, "utf8"));
            lines.forEach((line, index) => {
                if (HARDCODED_HOST.test(line)) {
                    violations.push({
                        file: path.relative(SRC_DIR, file),
                        line: index + 1,
                        content: line.trim(),
                        rule: "hardcoded host",
                    });
                }
            });
        }

        const rule: Rule[] = [{
            name: "hardcoded host",
            pattern: HARDCODED_HOST,
            reason: "Get the host from withHost() / resolveTransport() so an SSH source is reached over SSH.",
        }];
        expect(violations, formatViolationReport(violations, rule)).toEqual([]);
    });

    // Timeout raised well above the default, because this is the one test here that
    // imports the entire adapter registry - aws-sdk, googleapis, dropbox, ssh2, mssql
    // and everything else behind it. On its own that takes under two seconds, but in
    // the full suite it competes with 300-odd other files for CPU and occasionally
    // crossed the 5 s default. The test asserts a structural property and has no
    // business failing on machine load, and a limit that drifts closer to the edge
    // with every adapter added is a trap for whoever adds the next one.
    it("wires a transport for every SSH-capable adapter", async () => {
        // Structural, not textual: an adapter that offers an SSH credential
        // slot but resolves to a direct host would accept SSH settings in the
        // UI and quietly ignore them. Regexes cannot see that.
        const { registry } = await import("@/lib/core/registry");
        const { registerAdapters } = await import("@/lib/adapters");
        const { ADAPTER_CREDENTIAL_REQUIREMENTS } = await import("@/lib/core/credential-requirements");
        registerAdapters();

        const unwired: string[] = [];
        for (const [id, requirements] of Object.entries(ADAPTER_CREDENTIAL_REQUIREMENTS)) {
            if (!requirements.ssh) continue;

            const adapter = registry.get(id);
            if (!adapter) continue;

            const hasResolver = typeof (adapter as { transport?: unknown }).transport === "function";
            const shape = (adapter.configSchema as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
            if (!hasResolver && !("connectionMode" in shape)) {
                unwired.push(id);
            }
        }

        expect(
            unwired,
            `These adapters accept an SSH credential but resolve no transport:\n  ${unwired.join("\n  ")}\n` +
                "Add a `transport` resolver or a `connectionMode` field to the config schema.",
        ).toEqual([]);
    }, 30_000);

    it("passes a host to every adapter call in the integration tests", () => {
        // `test` and `ping` keep an optional host on BaseAdapter, because
        // requiring one there would have forced a host through 180 storage and
        // notification call sites that have no transport. The cost is that
        // forgetting one here compiles: the adapter then answers "requires an
        // execution host" and the test reads it as a failed connection.
        const files = findFiles(path.resolve(__dirname, "../../integration"));
        const call = /\badapter\.(test|ping|getDatabases|getDatabasesWithStats|dump|restore)!?\s*\(/;

        const violations: Violation[] = [];
        for (const file of files) {
            const lines = stripNonCode(fs.readFileSync(file, "utf8"));
            lines.forEach((line, index) => {
                if (call.test(line) && !line.includes("host")) {
                    violations.push({
                        file: path.relative(path.resolve(__dirname, "../../.."), file),
                        line: index + 1,
                        content: line.trim(),
                        rule: "adapter call without a host",
                    });
                }
            });
        }

        const rule: Rule[] = [{
            name: "adapter call without a host",
            pattern: call,
            reason: "Wrap the call in withHost(adapter, config, (host) => ...) so it uses the configured transport.",
        }];
        expect(violations, formatViolationReport(violations, rule)).toEqual([]);
    });

    it("confines ssh2 to the transport layer", () => {
        const files = findFiles(SRC_DIR, ["transport"]);
        const offenders = files.filter((file) => {
            if (file.startsWith(TRANSPORT_DIR)) return false;
            const lines = stripNonCode(fs.readFileSync(file, "utf8"));
            return lines.some((line) => /from\s+["']ssh2["']/.test(line));
        });

        expect(
            offenders.map((f) => path.relative(SRC_DIR, f)),
            "Only src/lib/transport/** may import ssh2 directly.",
        ).toEqual([]);
    });
});
