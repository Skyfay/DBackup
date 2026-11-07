import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

vi.mock("ssh2", () => ({ Client: vi.fn() }));

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }) },
}));

import { Client } from "ssh2";
import { SshHost } from "@/lib/transport/ssh-host";
import type { SshConnectionConfig } from "@/lib/transport/types";

const MockClient = Client as unknown as ReturnType<typeof vi.fn>;

/** A fake ssh2 exec channel: a Duplex that is stdout, with stderr on the side. */
class FakeChannel extends PassThrough {
    readonly stderr = new PassThrough();
    signal = vi.fn();
    close = vi.fn();

    finish(code: number, stdout = "", stderr = "") {
        if (stdout) this.write(stdout);
        if (stderr) this.stderr.write(stderr);
        this.end();
        this.stderr.end();
        this.emit("exit", code);
        this.emit("close");
    }
}

type FakeClient = EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
    sftp: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
};

const config: SshConnectionConfig = {
    host: "10.0.0.4",
    port: 2222,
    username: "ops",
    authType: "password",
    password: "hunter2",
};

describe("SshHost", () => {
    let client: FakeClient;
    let channels: FakeChannel[];
    let commands: string[];

    beforeEach(() => {
        vi.clearAllMocks();
        channels = [];
        commands = [];

        client = Object.assign(new EventEmitter(), {
            connect: vi.fn(() => setImmediate(() => client.emit("ready"))),
            exec: vi.fn((command: string, cb: (err: Error | undefined, ch: FakeChannel) => void) => {
                commands.push(command);
                const channel = new FakeChannel();
                channels.push(channel);
                setImmediate(() => cb(undefined, channel));
            }),
            sftp: vi.fn(),
            end: vi.fn(),
        }) as FakeClient;

        MockClient.mockImplementation(function () {
            return client;
        });
    });

    it("does not connect until an operation needs the connection", async () => {
        const host = new SshHost(config);
        expect(client.connect).not.toHaveBeenCalled();

        // Lazy connect is what keeps test() able to report a failed handshake as
        // { success: false } instead of throwing out of withHost.
        const pending = host.exec(["true"]);
        await vi.waitFor(() => expect(channels.length).toBe(1));
        expect(client.connect).toHaveBeenCalledTimes(1);
        channels[0].finish(0);
        await pending;
        await host.dispose();
    });

    it("reuses one connection across many commands", async () => {
        const host = new SshHost(config);
        const first = host.exec(["echo", "a"]);
        await vi.waitFor(() => expect(channels.length).toBe(1));
        channels[0].finish(0, "a\n");
        await first;

        const second = host.exec(["echo", "b"]);
        await vi.waitFor(() => expect(channels.length).toBe(2));
        channels[1].finish(0, "b\n");
        await second;

        expect(client.connect).toHaveBeenCalledTimes(1);
        await host.dispose();
    });

    it("renders argv through the shell escaper", async () => {
        const host = new SshHost(config);
        const pending = host.exec(["mysqldump", "--databases", "a'b"]);
        await vi.waitFor(() => expect(channels.length).toBe(1));
        channels[0].finish(0);
        await pending;

        expect(commands[0]).toBe("'mysqldump' '--databases' 'a'\\''b'");
        await host.dispose();
    });

    describe("environment values", () => {
        let files: Map<string, { options: Record<string, unknown> | undefined; content: string; mode?: number }>;
        let unlinked: string[];

        beforeEach(() => {
            files = new Map();
            unlinked = [];
            const sftp = {
                createWriteStream: (path: string, options?: Record<string, unknown>) => {
                    const entry: { options: Record<string, unknown> | undefined; content: string; mode?: number } = { options, content: "" };
                    files.set(path, entry);
                    return new Writable({
                        write(chunk, _encoding, done) {
                            entry.content += String(chunk);
                            done();
                        },
                    });
                },
                chmod: (path: string, mode: number, done: (err?: Error) => void) => {
                    files.get(path)!.mode = mode;
                    done();
                },
                unlink: (path: string, done: () => void) => {
                    unlinked.push(path);
                    done();
                },
                end: vi.fn(),
            };
            client.sftp.mockImplementation((done: (err: Error | undefined, s: typeof sftp) => void) => done(undefined, sftp));
        });

        it("go into a 0600 file the command sources, never into the command string", async () => {
            const host = new SshHost(config);
            const pending = host.exec(["pg_dump", "-h", "db"], { env: { PGPASSWORD: "s3cr3t", PGUSER: "" } });
            await vi.waitFor(() => expect(channels.length).toBe(1));
            channels[0].finish(0);
            await pending;

            const [path] = [...files.keys()];
            expect(path).toMatch(/^\/tmp\/dbackup_[0-9a-f-]+\.env$/);
            expect(files.get(path)).toEqual({ options: { flags: "wx", mode: 0o600 }, content: "export PGPASSWORD='s3cr3t'\n", mode: 0o600 });
            // The whole string is the argument of the remote shell, so all of it shows in `ps`.
            expect(commands[0]).not.toContain("s3cr3t");
            expect(commands[0]).toBe(`. '${path}' && rm -f '${path}' && 'pg_dump' '-h' 'db'`);
            // A command that exited 0 ran past the `rm`, so no second removal is needed.
            expect(unlinked).toEqual([]);
            await host.dispose();
        });

        it("are removed by the host when the command fails before or after sourcing them", async () => {
            const host = new SshHost(config);
            const pending = host.exec(["pg_dump"], { env: { PGPASSWORD: "s3cr3t" } });
            await vi.waitFor(() => expect(channels.length).toBe(1));
            channels[0].finish(1, "", "connection refused");

            expect((await pending).code).toBe(1);
            expect(unlinked).toEqual([...files.keys()]);
            await host.dispose();
        });

        it("are removed when the exec request itself fails", async () => {
            client.exec.mockImplementationOnce((_command: string, cb: (err: Error | undefined) => void) => {
                setImmediate(() => cb(new Error("channel open failure")));
            });
            const host = new SshHost(config);

            await expect(host.exec(["pg_dump"], { env: { PGPASSWORD: "s3cr3t" } })).rejects.toThrow(/channel open failure/);
            expect(unlinked).toEqual([...files.keys()]);
            expect(unlinked).toHaveLength(1);
            await host.dispose();
        });

        it("open no channel at all when there is nothing to export", async () => {
            const host = new SshHost(config);
            const pending = host.exec(["true"], { env: { PGPASSWORD: undefined } });
            await vi.waitFor(() => expect(channels.length).toBe(1));
            channels[0].finish(0);
            await pending;

            expect(files.size).toBe(0);
            expect(commands[0]).toBe("'true'");
            await host.dispose();
        });

        /** Records what the commands get on stdin, which a PassThrough would take as the end of the fake channel. */
        function recordStdin(): string[] {
            const stdin: string[] = [];
            client.exec.mockImplementation((command: string, cb: (err: undefined, ch: FakeChannel) => void) => {
                commands.push(command);
                const channel = new FakeChannel();
                const end = channel.end.bind(channel);
                // Closing stdin of a PassThrough would close the fake channel itself, so
                // the bytes are only recorded and finish() ends it.
                channel.end = ((chunk?: unknown) => {
                    if (typeof chunk === "string") {
                        stdin.push(chunk);
                        return channel;
                    }
                    return end();
                }) as typeof channel.end;
                channels.push(channel);
                setImmediate(() => cb(undefined, channel));
            });
            return stdin;
        }

        /** The script of the shell that writes the environment file, see `writeEnvFileByShell`. */
        const SHELL_SCRIPT = [
            "umask 077",
            'if f=$(mktemp "${TMPDIR:-/tmp}/dbackup_XXXXXXXXXX" 2>/dev/null); then :; else f=$1; (set -C; : > "$f") || exit 1; fi',
            'cat >> "$f" || { rm -f "$f"; exit 1; }',
            "printf '%s\\n' \"$f\"",
        ].join("\n");

        it("are written by a shell under umask 077, on stdin, when the host has no SFTP", async () => {
            client.sftp.mockImplementation((done: (err: Error) => void) => done(new Error("subsystem request failed")));
            const stdin = recordStdin();

            const host = new SshHost(config);
            const pending = host.exec(["pg_dump"], { env: { PGPASSWORD: "s3cr3t" } });
            await vi.waitFor(() => expect(channels.length).toBe(1));
            // `mktemp` names the file in the temp folder of the shell.
            channels[0].finish(0, "/var/tmp/dbackup_Ab12Cd34Ef\n");
            await vi.waitFor(() => expect(channels.length).toBe(2));
            channels[1].finish(0);
            await pending;

            const fallback = /'(\/tmp\/dbackup_[^']+\.env)'$/.exec(commands[0])![1];
            expect(commands[0]).toBe(`'sh' '-c' '${SHELL_SCRIPT.replace(/'/g, "'\\''")}' 'sh' '${fallback}'`);
            expect(stdin).toEqual(["export PGPASSWORD='s3cr3t'\n"]);
            expect(commands.join("\n")).not.toContain("s3cr3t");
            expect(commands[1]).toBe(". '/var/tmp/dbackup_Ab12Cd34Ef' && rm -f '/var/tmp/dbackup_Ab12Cd34Ef' && 'pg_dump'");
            await host.dispose();
        });

        // A read-only /tmp, or a chrooted SFTP whose /tmp is missing or not the one of the shell.
        it("are written by the shell when the SFTP write fails, and so are the next ones", async () => {
            const sftp = {
                createWriteStream: () => new Writable({
                    write(_chunk, _encoding, done) {
                        done(new Error("Permission denied"));
                    },
                }),
                chmod: vi.fn(),
                unlink: (path: string, done: () => void) => {
                    unlinked.push(path);
                    done();
                },
                end: vi.fn(),
            };
            client.sftp.mockImplementation((done: (err: Error | undefined, s: typeof sftp) => void) => done(undefined, sftp));
            const stdin = recordStdin();

            const host = new SshHost(config);
            for (const file of ["/tmp/dbackup_one", "/tmp/dbackup_two"]) {
                const before = channels.length;
                const pending = host.exec(["pg_dump"], { env: { PGPASSWORD: "s3cr3t" } });
                await vi.waitFor(() => expect(channels.length).toBe(before + 1));
                channels[before].finish(0, `${file}\n`);
                await vi.waitFor(() => expect(channels.length).toBe(before + 2));
                channels[before + 1].finish(0);
                await pending;
            }

            expect(commands).toHaveLength(4);
            expect(commands[0]).toContain("'sh' '-c' 'umask 077");
            expect(commands[1]).toBe(". '/tmp/dbackup_one' && rm -f '/tmp/dbackup_one' && 'pg_dump'");
            expect(commands[2]).toContain("'sh' '-c' 'umask 077");
            expect(commands[3]).toBe(". '/tmp/dbackup_two' && rm -f '/tmp/dbackup_two' && 'pg_dump'");
            expect(stdin).toEqual(["export PGPASSWORD='s3cr3t'\n", "export PGPASSWORD='s3cr3t'\n"]);
            // The file the failed SFTP write may have left is removed.
            expect(unlinked).toHaveLength(1);
            expect(unlinked[0]).toMatch(/^\/tmp\/dbackup_[0-9a-f-]+\.env$/);
            expect(commands.join("\n")).not.toContain("s3cr3t");
            expect(warn).not.toHaveBeenCalled();
            await host.dispose();
        });

        it("go inline into the command, with a warning, when no file can be written at all, so the command still runs", async () => {
            client.sftp.mockImplementation((done: (err: Error) => void) => done(new Error("subsystem request failed")));
            recordStdin();

            const host = new SshHost(config);
            for (let run = 0; run < 2; run++) {
                const before = channels.length;
                const pending = host.exec(["pg_dump"], { env: { PGPASSWORD: "s3cr3t" }, cwd: "/srv" });
                await vi.waitFor(() => expect(channels.length).toBe(before + 1));
                channels[before].finish(1, "", "sh: can't create /tmp/x: Read-only file system");
                await vi.waitFor(() => expect(channels.length).toBe(before + 2));
                channels[before + 1].finish(0);
                expect((await pending).code).toBe(0);
            }

            expect(commands[1]).toBe("export PGPASSWORD='s3cr3t'; cd '/srv' && 'pg_dump'");
            expect(commands[3]).toBe(commands[1]);
            // Once per host, not on every command.
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][1]).toEqual(expect.objectContaining({ reason: expect.stringContaining("Read-only file system") }));
            await host.dispose();
        });
    });

    it("returns a non-zero exit code without throwing", async () => {
        const host = new SshHost(config);
        const pending = host.exec(["false"]);
        await vi.waitFor(() => expect(channels.length).toBe(1));
        channels[0].finish(2, "", "denied");

        const result = await pending;
        expect(result.code).toBe(2);
        expect(result.stderr).toBe("denied");
        await host.dispose();
    });

    it("resolves a binary with command -v and memoizes the lookup", async () => {
        const host = new SshHost(config);
        const first = host.which("mariadb-dump", "mysqldump");
        await vi.waitFor(() => expect(channels.length).toBe(1));
        channels[0].finish(0, "/usr/bin/mariadb-dump\n");

        expect(await first).toBe("/usr/bin/mariadb-dump");
        expect(commands[0]).toBe("'command' '-v' 'mariadb-dump'");

        // The second call must not open another channel.
        expect(host.which("mariadb-dump", "mysqldump")).toBe(first);
        expect(channels.length).toBe(1);
        await host.dispose();
    });

    it("tries every candidate before giving up", async () => {
        const host = new SshHost(config);
        const pending = host.which("mariadb-dump", "mysqldump");

        await vi.waitFor(() => expect(channels.length).toBe(1));
        channels[0].finish(1);
        await vi.waitFor(() => expect(channels.length).toBe(2));
        channels[1].finish(1);

        await expect(pending).rejects.toThrow(/mariadb-dump, mysqldump/);
        await host.dispose();
    });

    it("caps concurrent channels so the server session limit is not exhausted", async () => {
        // OpenSSH allows 10 sessions by default and SFTP claims one. Postgres
        // counts tables under Promise.all, so an uncapped fan-out is reachable.
        const host = new SshHost(config);
        const running = Array.from({ length: 10 }, (_, i) => host.exec(["echo", String(i)]));

        await vi.waitFor(() => expect(channels.length).toBe(4));
        expect(channels.length).toBe(4);

        channels[0].finish(0);
        await vi.waitFor(() => expect(channels.length).toBe(5));

        channels.slice(1).forEach((channel) => channel.finish(0));
        await Promise.all(running.slice(0, 5));
        await host.dispose();
    });

    it("closes the client on dispose and stays idempotent", async () => {
        const host = new SshHost(config);
        const pending = host.exec(["true"]);
        await vi.waitFor(() => expect(channels.length).toBe(1));
        channels[0].finish(0);
        await pending;

        await host.dispose();
        expect(client.end).toHaveBeenCalledTimes(1);

        await expect(host.dispose()).resolves.toBeUndefined();
        expect(client.end).toHaveBeenCalledTimes(1);
    });

    it("rejects further work after disposal", async () => {
        const host = new SshHost(config);
        await host.dispose();
        await expect(host.exec(["true"])).rejects.toThrow(/already been disposed/);
    });

    it("never puts credentials in the loggable label", () => {
        const host = new SshHost(config);
        expect(host.label).toBe("ssh://ops@10.0.0.4:2222");
        expect(host.label).not.toContain("hunter2");
    });
});

/**
 * Channel event timing.
 *
 * ssh2 delivers a short command's output, exit status and close in the same
 * batch. Anything the caller does after an `await` therefore happens too late
 * to observe them, which is what these two tests pin down. The bugs they cover
 * both looked the same from the outside: a command that plainly succeeded was
 * reported as a failure.
 */
describe("SshHost channel timing", () => {
    let client: FakeClient;

    function mountClient(exec: FakeClient["exec"]) {
        client = Object.assign(new EventEmitter(), {
            connect: vi.fn(() => setImmediate(() => client.emit("ready"))),
            exec,
            sftp: vi.fn(),
            end: vi.fn(),
        }) as FakeClient;
        MockClient.mockImplementation(function () {
            return client;
        });
    }

    it("keeps the exit status when it arrives inside the exec callback", async () => {
        // The exit status is emitted before an awaiting caller could resume.
        // Losing it left exec() reporting `code: null` for a successful
        // command, which every `code !== 0` check in the adapters reads as a
        // failure - it surfaced as "binary not found" for a binary that exists.
        mountClient(vi.fn((_command: string, cb: (err: undefined, ch: FakeChannel) => void) => {
            const channel = new FakeChannel();
            setImmediate(() => {
                cb(undefined, channel);
                channel.write('/usr/bin/psql\n');
                channel.emit('exit', 0);
                setImmediate(() => {
                    channel.end();
                    channel.emit('close');
                });
            });
        }));

        const host = new SshHost(config);
        const result = await host.exec(['command', '-v', 'psql']);

        expect(result.code).toBe(0);
        expect(result.stdout).toBe('/usr/bin/psql\n');
    });

    it("does not hang when a stream closes without ever ending", async () => {
        // `close` was observed arriving before `end`, so the output is read
        // only after the streams settle. That wait has to stay bounded: a
        // channel's stderr can close without ever ending, and kill() leaves a
        // destroyed stream behind. Waiting for `end` unconditionally would
        // deadlock every command that hits either case.
        mountClient(vi.fn((_command: string, cb: (err: undefined, ch: FakeChannel) => void) => {
            const channel = new FakeChannel();
            setImmediate(() => {
                cb(undefined, channel);
                channel.write('one\ntwo\nthree\n');
                channel.emit('exit', 0);
                // Only `close`, and stderr is left dangling on purpose.
                setImmediate(() => channel.emit('close'));
            });
        }));

        const host = new SshHost(config);
        const result = await host.exec(['mysql', '-e', 'SHOW DATABASES']);

        expect(result.code).toBe(0);
        expect(result.stdout).toBe('one\ntwo\nthree\n');
    });
});
