import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";

import { DirectHost } from "@/lib/transport/direct-host";

/**
 * DirectHost is exercised against real processes and a real filesystem.
 *
 * Mocking child_process here would only prove that the mock matches the code.
 * These cases double as the reference behaviour that SshHost has to match.
 */
describe("DirectHost", () => {
    let host: DirectHost;
    let dir: string;

    beforeEach(async () => {
        host = new DirectHost();
        dir = await mkdtemp(join(os.tmpdir(), "dbackup-direct-"));
    });

    afterEach(async () => {
        await host.dispose();
        await rm(dir, { recursive: true, force: true });
    });

    describe("exec()", () => {
        it("captures stdout and a zero exit code", async () => {
            const result = await host.exec(["echo", "hello"]);
            expect(result.stdout.trim()).toBe("hello");
            expect(result.code).toBe(0);
        });

        it("returns a non-zero exit code instead of throwing", async () => {
            // pg_restore and mysql both exit non-zero on recoverable warnings, so
            // the judgement has to stay with the adapter.
            const result = await host.exec(["sh", "-c", "echo boom >&2; exit 3"]);
            expect(result.code).toBe(3);
            expect(result.stderr.trim()).toBe("boom");
        });

        it("passes each argv entry as one argument, without shell interpretation", async () => {
            const result = await host.exec(["echo", "a b", "$(id)", "a'b"]);
            expect(result.stdout.trim()).toBe("a b $(id) a'b");
        });

        it("applies extra environment variables", async () => {
            const result = await host.exec(["sh", "-c", "printf %s \"$MY_TOKEN\""], {
                env: { MY_TOKEN: "s3cr3t" },
            });
            expect(result.stdout).toBe("s3cr3t");
        });

        it("removes an environment variable set to undefined", async () => {
            process.env.DBACKUP_SPIKE = "present";
            try {
                const result = await host.exec(["sh", "-c", "printf %s \"${DBACKUP_SPIKE-unset}\""], {
                    env: { DBACKUP_SPIKE: undefined },
                });
                expect(result.stdout).toBe("unset");
            } finally {
                delete process.env.DBACKUP_SPIKE;
            }
        });

        it("runs in the requested working directory", async () => {
            const result = await host.exec(["pwd"], { cwd: dir });
            expect(result.stdout.trim()).toContain("dbackup-direct-");
        });

        it("writes provided bytes to stdin", async () => {
            const result = await host.exec(["cat"], { stdin: "piped input" });
            expect(result.stdout).toBe("piped input");
        });

        it("feeds a file on this host to stdin", async () => {
            const file = join(dir, "in.txt");
            await writeFile(file, "from file");
            const result = await host.exec(["cat"], { stdinFile: file });
            expect(result.stdout).toBe("from file");
        });

        it("rejects both stdin and stdinFile at once", async () => {
            await expect(host.exec(["cat"], { stdin: "a", stdinFile: "/tmp/b" }))
                .rejects.toThrow(/either `stdin` or `stdinFile`/);
        });

        it("fails on buffer overflow rather than truncating output", async () => {
            // Silently truncating would corrupt a database list.
            await expect(host.exec(["sh", "-c", "yes abcdefgh | head -c 200000"], { maxBuffer: 1024 }))
                .rejects.toThrow(/exceeded the 1024 byte limit/);
        });

        it("fails when the command outlives its timeout", async () => {
            await expect(host.exec(["sleep", "5"], { timeoutMs: 150 }))
                .rejects.toThrow(/timed out after 150 ms/);
        });

        it("rejects when the binary does not exist", async () => {
            await expect(host.exec(["dbackup-does-not-exist"])).rejects.toThrow();
        });

        it("rejects an empty argv array", async () => {
            await expect(host.exec([])).rejects.toThrow(/empty argv/);
        });
    });

    describe("which()", () => {
        it("resolves the first available candidate", async () => {
            expect(await host.which("dbackup-missing-binary", "sh")).toBe("sh");
        });

        it("memoizes a successful lookup", async () => {
            const first = host.which("sh");
            const second = host.which("sh");
            expect(first).toBe(second);
            expect(await first).toBe("sh");
        });

        it("does not cache a failure, so installing the tool takes effect without a restart", async () => {
            await expect(host.which("dbackup-missing-binary")).rejects.toThrow();
            // A cached rejection would be returned as the same promise object.
            const retry = host.which("dbackup-missing-binary");
            await expect(retry).rejects.toThrow(/None of the following binaries/);
        });

        it("accepts an explicit path configured by the user", async () => {
            const file = join(dir, "custom-tool");
            await writeFile(file, "#!/bin/sh\n", { mode: 0o755 });
            expect(await host.which(file)).toBe(file);
        });

        it("throws naming every candidate it tried", async () => {
            await expect(host.which("nope-a", "nope-b"))
                .rejects.toThrow(/nope-a, nope-b/);
        });

        it("requires at least one candidate", async () => {
            await expect(host.which()).rejects.toThrow(/at least one candidate/);
        });
    });

    describe("withTempFile()", () => {
        it("writes the content and removes the file afterwards", async () => {
            let seen = "";
            const path = await host.withTempFile({ content: "hello", suffix: ".cnf" }, async (p) => {
                seen = await readFile(p, "utf8");
                expect(p.endsWith(".cnf")).toBe(true);
                return p;
            });
            expect(seen).toBe("hello");
            await expect(stat(path)).rejects.toThrow();
        });

        it("applies the requested mode", async () => {
            await host.withTempFile({ content: "[client]", mode: 0o600 }, async (p) => {
                const stats = await stat(p);
                expect(stats.mode & 0o777).toBe(0o600);
            });
        });

        it("never writes through a file or a link laid under its name first", async () => {
            const planted = join(dir, "planted");
            const victim = join(dir, "victim.txt");
            await writeFile(victim, "untouched");
            await symlink(victim, planted);
            class GuessedName extends DirectHost {
                protected override hostTempPath(): string {
                    return planted;
                }
            }
            const guessed = new GuessedName();

            await expect(guessed.withTempFile({ content: "[client]\npassword=secret", mode: 0o600 }, async () => "ran")).rejects.toThrow(/EEXIST/);
            expect(await readFile(victim, "utf8")).toBe("untouched");
            await guessed.dispose();
        });

        it("removes the file even when the callback throws", async () => {
            let captured = "";
            await expect(
                host.withTempFile({ content: "x" }, async (p) => {
                    captured = p;
                    throw new Error("callback failed");
                }),
            ).rejects.toThrow("callback failed");
            await expect(stat(captured)).rejects.toThrow();
        });
    });

    describe("stageInput()", () => {
        it("passes the local path straight through when no transform is needed", async () => {
            // Copying a multi-gigabyte dump to run it locally would be pure waste.
            const file = join(dir, "dump.sql");
            await writeFile(file, "CREATE TABLE t;");
            const staged = await host.stageInput(file, {}, async (p) => p);
            expect(staged).toBe(file);
            // The original must still exist: nothing was cleaned up.
            expect((await stat(file)).size).toBeGreaterThan(0);
        });

        it("rewrites bytes through a transform and verifies the transformed size", async () => {
            const file = join(dir, "dump.sql");
            await writeFile(file, "create table t;");
            const upper = () =>
                new Transform({
                    transform(chunk, _enc, cb) {
                        cb(null, Buffer.from(chunk.toString().toUpperCase()));
                    },
                });

            const content = await host.stageInput(file, { transform: upper }, async (p) => readFile(p, "utf8"));
            expect(content).toBe("CREATE TABLE T;");
        });

        it("never streams a staged copy through a file or a link laid under its name first", async () => {
            const file = join(dir, "dump.sql");
            await writeFile(file, "dump bytes");
            const planted = join(dir, "planted");
            const victim = join(dir, "victim.txt");
            await writeFile(victim, "untouched");
            await symlink(victim, planted);
            class GuessedName extends DirectHost {
                protected override hostTempPath(): string {
                    return planted;
                }
            }
            const guessed = new GuessedName();
            const passthrough = () => new Transform({ transform: (c, _e, cb) => cb(null, c) });

            await expect(guessed.stageInput(file, { transform: passthrough }, async () => "ran")).rejects.toThrow(/EEXIST/);
            expect(await readFile(victim, "utf8")).toBe("untouched");
            await guessed.dispose();
        });

        it("cleans up the staged copy even when the callback throws", async () => {
            const file = join(dir, "dump.sql");
            await writeFile(file, "abc");
            const passthrough = () => new Transform({ transform: (c, _e, cb) => cb(null, c) });

            let staged = "";
            await expect(
                host.stageInput(file, { transform: passthrough }, async (p) => {
                    staged = p;
                    throw new Error("restore failed");
                }),
            ).rejects.toThrow("restore failed");
            await expect(stat(staged)).rejects.toThrow();
        });
    });

    describe("captureOutput()", () => {
        it("lets the command write straight to its destination", async () => {
            const target = join(dir, "out.rdb");
            await host.captureOutput(target, {}, async (p) => {
                expect(p).toBe(target);
                await writeFile(p, "payload");
            });
            expect(await readFile(target, "utf8")).toBe("payload");
        });
    });

    describe("forwardPort()", () => {
        it("returns the original address unchanged", async () => {
            const forward = await host.forwardPort("db.internal", 1433);
            expect(forward).toMatchObject({
                host: "db.internal",
                port: 1433,
                forwarded: false,
                lastError: null,
            });
            await forward.close();
        });
    });

    describe("dispose()", () => {
        it("is idempotent", async () => {
            await host.dispose();
            await expect(host.dispose()).resolves.toBeUndefined();
        });
    });
});
