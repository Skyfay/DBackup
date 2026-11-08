// @vitest-environment node
/**
 * A temp file of a host is created exclusively. The temp folder is shared with every account of
 * the machine, so a file or a link someone laid under the name first must fail the write instead
 * of receiving a login like a `.my.cnf`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

const uuid = vi.hoisted(() => ({ value: "" }));
vi.mock("node:crypto", async (importOriginal) => {
    const original = await importOriginal<typeof import("node:crypto")>();
    return { ...original, randomUUID: () => uuid.value || original.randomUUID() };
});
vi.mock("ssh2", () => ({ Client: vi.fn() }));

import { Client } from "ssh2";
import { SshHost } from "@/lib/transport/ssh-host";
import { CompositeHost } from "@/lib/transport/composite-host";
import type { ExecutionHost } from "@/lib/transport/types";

describe("a temp file over SSH", () => {
    let opened: { path: string; options: Record<string, unknown> | undefined }[];

    beforeEach(() => {
        opened = [];
        const sftp = {
            createWriteStream: (path: string, options?: Record<string, unknown>) => {
                opened.push({ path, options });
                return new Writable({ write: (_chunk, _encoding, done) => done() });
            },
            chmod: (_path: string, _mode: number, done: (err?: Error) => void) => done(),
            unlink: (_path: string, done: () => void) => done(),
        };
        const client = Object.assign(new EventEmitter(), {
            connect: vi.fn(() => setImmediate(() => client.emit("ready"))),
            sftp: vi.fn((done: (err: Error | undefined, s: typeof sftp) => void) => done(undefined, sftp)),
            exec: vi.fn(),
            end: vi.fn(),
        });
        (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () { return client; });
    });

    it("is opened with the exclusive flag, with and without a mode", async () => {
        const host = new SshHost({ host: "10.0.0.4", port: 22, username: "ops", authType: "password", password: "x" });
        await host.withTempFile({ content: "[client]\npassword=secret", mode: 0o600 }, async () => "ran");
        await host.withTempFile({ content: "plain" }, async () => "ran");

        expect(opened.map((entry) => entry.options)).toEqual([{ flags: "wx", mode: 0o600 }, { flags: "wx" }]);
        await host.dispose();
    });
});

describe("a temp file staged on this server for another host", () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(join(os.tmpdir(), "composite-temp-")); });
    afterEach(async () => {
        uuid.value = "";
        await rm(dir, { recursive: true, force: true });
    });

    it("never writes through a link laid under its name first", async () => {
        uuid.value = "planted-name";
        const victim = join(dir, "victim.txt");
        await writeFile(victim, "untouched");
        const planted = join(os.tmpdir(), "dbackup_planted-name");
        await rm(planted, { force: true });
        await symlink(victim, planted);

        const putFile = vi.fn(async () => undefined);
        const fileHost = { kind: "ssh", label: "files", tmpDir: "/tmp", putFile, dispose: async () => undefined } as unknown as ExecutionHost;
        const execHost = { kind: "direct", label: "exec", tmpDir: "/tmp", dispose: async () => undefined } as unknown as ExecutionHost;
        const host = new CompositeHost(execHost, fileHost);

        try {
            await expect(host.withTempFile({ content: "[client]\npassword=secret", mode: 0o600 }, async () => "ran")).rejects.toThrow(/EEXIST/);
            expect(await readFile(victim, "utf8")).toBe("untouched");
            expect(putFile).not.toHaveBeenCalled();
        } finally {
            await rm(planted, { force: true });
        }
    });
});
