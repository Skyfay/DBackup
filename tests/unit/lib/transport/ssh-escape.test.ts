import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { shellEscape, buildRemoteCommand, renderEnvFile } from "@/lib/transport/ssh-escape";

const execFileAsync = promisify(execFile);

/**
 * Run a rendered command through a real /bin/sh and recover the argv the shell
 * actually produced.
 *
 * This is what turns the escaping from "looks right" into "provably right":
 * `printf '%s\0'` emits each argument verbatim separated by NUL, so any quoting
 * mistake shows up as a split, merged, or mangled argument.
 */
async function roundTripArgv(args: string[]): Promise<string[]> {
    const command = buildRemoteCommand(["printf", "%s\\0", ...args]);
    const { stdout } = await execFileAsync("/bin/sh", ["-c", command], {
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
    });
    const parts = stdout.toString("utf8").split("\0");
    // printf emits a trailing NUL after the last argument.
    parts.pop();
    return parts;
}

describe("shellEscape", () => {
    it("wraps a plain value in single quotes", () => {
        expect(shellEscape("hello")).toBe("'hello'");
    });

    it("preserves an empty string as an explicit empty argument", () => {
        expect(shellEscape("")).toBe("''");
    });

    it("closes and reopens the quote around an embedded single quote", () => {
        expect(shellEscape("a'b")).toBe("'a'\\''b'");
    });

    it("leaves shell metacharacters literal instead of escaping them", () => {
        // Inside single quotes these are already inert, so no backslashes appear.
        expect(shellEscape("$(id)")).toBe("'$(id)'");
        expect(shellEscape("`id`")).toBe("'`id`'");
        expect(shellEscape("a\\b")).toBe("'a\\b'");
    });

    it("rejects a NUL byte rather than truncating the argument", () => {
        expect(() => shellEscape("a\0b")).toThrow(/NUL byte/);
    });
});

describe("buildRemoteCommand", () => {
    it("rejects an empty argv array", () => {
        expect(() => buildRemoteCommand([])).toThrow(/empty argv/);
    });

    it("quotes every argument independently", () => {
        expect(buildRemoteCommand(["mysqldump", "--user", "root"]))
            .toBe("'mysqldump' '--user' 'root'");
    });

    it("sources the environment file and removes it before the command runs", () => {
        const command = buildRemoteCommand(["mysqldump", "-h", "db"], { envFile: "/tmp/dbackup_x.env" });
        expect(command).toBe(". '/tmp/dbackup_x.env' && rm -f '/tmp/dbackup_x.env' && 'mysqldump' '-h' 'db'");
    });

    it("guards the command with cd so it cannot run in the wrong directory", () => {
        expect(buildRemoteCommand(["ls"], { cwd: "/var/backups" }))
            .toBe("cd '/var/backups' && 'ls'");
    });

    it("redirects stdin from a file on the remote host", () => {
        expect(buildRemoteCommand(["mysql"], { stdinFile: "/tmp/dump.sql" }))
            .toBe("'mysql' < '/tmp/dump.sql'");
    });

    it("orders the environment file, then cd, then the command", () => {
        expect(buildRemoteCommand(["mysql"], {
            envFile: "/tmp/e.env",
            cwd: "/tmp",
            stdinFile: "/tmp/in.sql",
        })).toBe(". '/tmp/e.env' && rm -f '/tmp/e.env' && cd '/tmp' && 'mysql' < '/tmp/in.sql'");
    });
});

describe("buildRemoteCommand with inline values", () => {
    // The last resort of a target where no environment file could be written, see `SshHost.writeEnvFile`.
    it("exports them in front of the command, before cd, and prefers a file when there is one", () => {
        expect(buildRemoteCommand(["mysql"], { inlineEnv: { MYSQL_PWD: "s3cr3t", EMPTY: "" }, cwd: "/srv" }))
            .toBe("export MYSQL_PWD='s3cr3t'; cd '/srv' && 'mysql'");
        expect(buildRemoteCommand(["mysql"], { inlineEnv: { MYSQL_PWD: "s3cr3t" }, envFile: "/tmp/e.env" }))
            .toBe(". '/tmp/e.env' && rm -f '/tmp/e.env' && 'mysql'");
        expect(buildRemoteCommand(["mysql"], { inlineEnv: { MYSQL_PWD: undefined } })).toBe("'mysql'");
    });

    it("hands a hostile value with a newline to the command unchanged through a real shell", async () => {
        const secret = "a'b $(id) `id` \"q\" \\ ; | & *\nline2";
        const command = buildRemoteCommand(["sh", "-c", 'printf %s "$SECRET"'], { inlineEnv: { SECRET: secret } });
        const { stdout } = await execFileAsync("/bin/sh", ["-c", command]);
        expect(stdout).toBe(secret);
    });
});

describe("renderEnvFile", () => {
    it("renders one export line per value", () => {
        expect(renderEnvFile({ PGPASSWORD: "s3cr3t", PGHOST: "db" }))
            .toBe("export PGPASSWORD='s3cr3t'\nexport PGHOST='db'\n");
    });

    it("skips undefined and empty values and returns null when nothing is left", () => {
        expect(renderEnvFile({ PGPASSWORD: undefined, PGUSER: "", PGHOST: "db" })).toBe("export PGHOST='db'\n");
        expect(renderEnvFile({ PGPASSWORD: undefined, PGUSER: "" })).toBeNull();
        expect(renderEnvFile(undefined)).toBeNull();
    });

    it("rejects an environment name that is not a valid shell identifier", () => {
        expect(() => renderEnvFile({ "A;rm -rf /": "x" })).toThrow(/Invalid environment variable name/);
    });

    it("hands hostile values to the command unchanged through a real shell, and the file is gone", async () => {
        const dir = await mkdtemp(join(os.tmpdir(), "env-file-"));
        const envFile = join(dir, "e.env");
        const secret = "a'b $(id) `id` \"q\" \\ ; | & *\nline2";
        try {
            await writeFile(envFile, renderEnvFile({ SECRET: secret }) ?? "", { mode: 0o600 });
            const command = buildRemoteCommand(["sh", "-c", 'printf %s "$SECRET"'], { envFile });

            expect(command).not.toContain("a'b");
            const { stdout } = await execFileAsync("/bin/sh", ["-c", command]);
            expect(stdout).toBe(secret);
            expect(existsSync(envFile)).toBe(false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("does not run the command when the environment file is missing", async () => {
        const command = buildRemoteCommand(["echo", "ran"], { envFile: "/nonexistent/dbackup.env" });
        const result = await execFileAsync("/bin/sh", ["-c", command]).catch((error: { code: number; stdout: string }) => error);
        expect(result.stdout).not.toContain("ran");
    });
});

describe("argv round-trip through a real shell", () => {
    const payloads: Array<[string, string]> = [
        ["plain value", "database"],
        ["empty string", ""],
        ["spaces", "my database"],
        ["single quote", "a'b"],
        ["double quote", 'a"b'],
        ["backslash", "a\\b"],
        ["command substitution", "a'; rm -rf /; echo '"],
        ["dollar substitution", "$(id)"],
        ["backtick substitution", "`id`"],
        ["variable expansion", "$HOME"],
        ["semicolon", "a;b"],
        ["pipe and redirect", "a|b>c<d"],
        ["ampersand", "a&b"],
        ["glob", "*"],
        ["newline", "line1\nline2"],
        ["tab", "a\tb"],
        ["leading dash", "--user=$(whoami)"],
        ["non-ascii", "Grüße_日本語_🚀"],
        ["quote soup", `'"''"'`],
    ];

    it.each(payloads)("survives %s unchanged", async (_label, payload) => {
        expect(await roundTripArgv([payload])).toEqual([payload]);
    });

    it("keeps multiple hostile arguments separate", async () => {
        const args = ["a b", "a'b", "$(id)", "", "--flag=x y"];
        expect(await roundTripArgv(args)).toEqual(args);
    });

    it("survives a 4 KiB argument", async () => {
        const payload = "x".repeat(4096);
        expect(await roundTripArgv([payload])).toEqual([payload]);
    });

    it("does not let an injected argument execute a command", async () => {
        // If quoting were broken this would run `id` and leak its output.
        const [result] = await roundTripArgv(["'; id #"]);
        expect(result).toBe("'; id #");
        expect(result).not.toMatch(/uid=\d+/);
    });
});
