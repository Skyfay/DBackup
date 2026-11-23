/**
 * An SFTP upload never writes through an entry already at its name, and a write or link of a restore
 * never lands below a link in the folder it restores into. The server follows links when it opens a
 * path, so a link planted at the name of a restored file carried its bytes outside the folder of the
 * restore and the path of the connection, and a link `x -> ..` an earlier restore laid let a later one
 * write `x/jobs/victim.txt` into the files of another job.
 *
 * The fake server below follows links the way OpenSSH's sftp-server does: an open with `w` writes
 * through a link at the name, an open with `wx` fails on any entry there, `posix-rename` replaces
 * the entry at the new name, and a stat looks at the last part of a path only.
 */
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SFTPAdapter } from "@/lib/adapters/storage/sftp";

type Entry = { kind: "d" | "-" | "l"; content?: string; target?: string };

const { remote, raw } = vi.hoisted(() => {
    const remote = new Map<string, { kind: "d" | "-" | "l"; content?: string; target?: string }>();
    /** Opens like sftp-server: `w` follows a link at the name, `wx` creates a new file or fails. */
    const open = (remotePath: string, flags: string): Error | undefined => {
        const entry = remote.get(remotePath);
        if (flags === "wx" && entry) return new Error("Failure");
        const at = entry?.kind === "l" ? entry.target! : remotePath;
        remote.set(at, { kind: "-", content: "WRITTEN-BY-RESTORE" });
        return undefined;
    };
    type Open = (remotePath: string, flags: string, cb: (err: Error | undefined, handle?: Buffer) => void) => void;
    const raw = {
        _extensions: {} as Record<string, string>,
        opens: [] as { path: string; flags: string }[],
        open(remotePath: string, flags: string, cb: (err: Error | undefined, handle?: Buffer) => void) {
            raw.opens.push({ path: remotePath, flags });
            const err = open(remotePath, flags);
            cb(err, err ? undefined : Buffer.from("handle"));
        },
        // Like ssh2, which opens the destination through `this` with `w`.
        fastPut(this: { open: Open }, _local: string, remotePath: string, _options: unknown, cb: (err?: Error) => void) {
            this.open(remotePath, "w", (err: Error | undefined) => cb(err));
        },
        lstat: vi.fn((_remotePath: string, cb: (err: Error | undefined, attrs: { mode: number; uid: number; gid: number }) => void) => {
            cb(undefined, { mode: 0o100750, uid: 1000, gid: 1000 });
        }),
        setstat: vi.fn((_remotePath: string, _attrs: unknown, cb: (err?: Error) => void) => cb()),
        symlink: vi.fn((target: string, linkPath: string, cb: (err?: Error) => void) => {
            remote.set(linkPath, { kind: "l", target });
            cb();
        }),
        open_: open,
    };
    return { remote, raw };
});

vi.mock("ssh2-sftp-client", () => {
    class MockSFTPClient {
        sftp = raw;
        connect = vi.fn().mockResolvedValue(undefined);
        end = vi.fn().mockResolvedValue(undefined);
        exists = vi.fn(async (p: string) => remote.get(p)?.kind ?? false);
        mkdir = vi.fn(async (p: string) => { remote.set(p, { kind: "d" }); });
        // Follows every link on the way, like the server's realpath.
        realPath = vi.fn(async (p: string) => {
            let resolved = "/";
            for (const part of p.split("/").filter(Boolean)) {
                resolved = path.posix.join(resolved, part);
                for (let hops = 0; remote.get(resolved)?.kind === "l"; hops++) {
                    if (hops > 8) throw new Error("Too many links");
                    resolved = path.posix.resolve(path.posix.dirname(resolved), remote.get(resolved)!.target!);
                }
            }
            return resolved;
        });
        delete = vi.fn(async (p: string) => { remote.delete(p); });
        posixRename = vi.fn(async (from: string, to: string) => {
            const entry = remote.get(from);
            if (!entry || remote.get(to)?.kind === "d") throw new Error("Failure");
            remote.delete(from);
            remote.set(to, entry);
        });
        // The wrapper's own fastPut opens with `w`, through a link.
        fastPut = vi.fn(async (_local: string, remotePath: string) => {
            raw.opens.push({ path: remotePath, flags: "w" });
            const err = raw.open_(remotePath, "w");
            if (err) throw err;
        });
    }
    return { default: MockSFTPClient };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

const config = { host: "sftp.example.com", port: 22, username: "backupuser", password: "secret", pathPrefix: "/srv/conn" };

function seed(entries: Record<string, Entry>): void {
    remote.clear();
    for (const dir of ["/srv", "/srv/conn", "/srv/conn/apps", "/srv/conn/jobs", "/srv/outside"]) remote.set(dir, { kind: "d" });
    remote.set("/srv/outside/leafvictim.txt", { kind: "-", content: "ORIGINAL" });
    remote.set("/srv/conn/jobs/victim.txt", { kind: "-", content: "ORIGINAL" });
    for (const [p, entry] of Object.entries(entries)) remote.set(p, entry);
}

const leftovers = () => [...remote.keys()].filter((p) => p.includes(".dbackup-"));

beforeEach(() => {
    raw.opens = [];
    raw._extensions = {};
    raw.symlink.mockClear();
    raw.setstat.mockClear();
});

describe("an SFTP upload onto a link already at the name", () => {
    it("replaces the link with the file through a rename and never opens the name itself", async () => {
        seed({ "/srv/conn/apps/leaf.txt": { kind: "l", target: "/srv/outside/leafvictim.txt" } });
        raw._extensions = { "posix-rename@openssh.com": "1" };

        const ok = await SFTPAdapter.upload(config, "/tmp/stage", "apps/leaf.txt", undefined, undefined, { restoreRelativePath: "leaf.txt" });

        expect(ok).toBe(true);
        expect(remote.get("/srv/outside/leafvictim.txt")?.content).toBe("ORIGINAL");
        expect(remote.get("/srv/conn/apps/leaf.txt")).toEqual({ kind: "-", content: "WRITTEN-BY-RESTORE" });
        expect(raw.opens).toHaveLength(1);
        expect(raw.opens[0]).toEqual({ path: expect.stringMatching(/^\/srv\/conn\/apps\/\.dbackup-[0-9a-f-]+\.part$/), flags: "wx" });
        expect(leftovers()).toEqual([]);
    });

    it("removes the link first on a server without posix-rename, then creates the file exclusively", async () => {
        seed({ "/srv/conn/apps/leaf.txt": { kind: "l", target: "/srv/outside/leafvictim.txt" } });

        const ok = await SFTPAdapter.upload(config, "/tmp/stage", "apps/leaf.txt", undefined, undefined, { restoreRelativePath: "leaf.txt" });

        expect(ok).toBe(true);
        expect(remote.get("/srv/outside/leafvictim.txt")?.content).toBe("ORIGINAL");
        expect(remote.get("/srv/conn/apps/leaf.txt")?.kind).toBe("-");
        expect(raw.opens).toEqual([{ path: "/srv/conn/apps/leaf.txt", flags: "wx" }]);
    });

    it("never writes through a link at the name of a backup either", async () => {
        seed({ "/srv/conn/apps/backup.tar": { kind: "l", target: "/srv/outside/leafvictim.txt" } });
        raw._extensions = { "posix-rename@openssh.com": "1" };

        expect(await SFTPAdapter.upload(config, "/tmp/stage", "apps/backup.tar")).toBe(true);
        expect(remote.get("/srv/outside/leafvictim.txt")?.content).toBe("ORIGINAL");
    });

    it("removes the new file again when the rename fails", async () => {
        // A folder at the name, which a rename never replaces.
        seed({ "/srv/conn/apps/taken": { kind: "d" } });
        raw._extensions = { "posix-rename@openssh.com": "1" };

        expect(await SFTPAdapter.upload(config, "/tmp/stage", "apps/taken")).toBe(false);
        expect(leftovers()).toEqual([]);
    });
});

describe("an SFTP upload onto a name that holds no link", () => {
    it("creates a new file at its name with an exclusive create and no file beside it", async () => {
        seed({});
        raw._extensions = { "posix-rename@openssh.com": "1" };

        expect(await SFTPAdapter.upload(config, "/tmp/stage", "apps/backup.tar")).toBe(true);
        expect(raw.opens).toEqual([{ path: "/srv/conn/apps/backup.tar", flags: "wx" }]);
    });

    it("replaces a file through a rename and hands the new file its owner, then its mode", async () => {
        seed({ "/srv/conn/apps/run.sh": { kind: "-", content: "ORIGINAL" } });
        raw._extensions = { "posix-rename@openssh.com": "1" };

        const ok = await SFTPAdapter.upload(config, "/tmp/stage", "apps/run.sh", undefined, undefined, { restoreRelativePath: "run.sh" });

        expect(ok).toBe(true);
        expect(remote.get("/srv/conn/apps/run.sh")?.content).toBe("WRITTEN-BY-RESTORE");
        const temp = raw.opens[0].path;
        expect(temp).toMatch(/\/\.dbackup-[0-9a-f-]+\.part$/);
        expect(raw.setstat.mock.calls.map(([at, attrs]) => [at, attrs])).toEqual([
            [temp, { uid: 1000, gid: 1000 }],
            [temp, { mode: 0o750 }],
        ]);
        expect(leftovers()).toEqual([]);
    });
});

describe("a write or link of a restore below a link in the folder it restores into", () => {
    it("refuses a write below a link an earlier restore laid, which would land beside the folder", async () => {
        seed({ "/srv/conn/apps/x": { kind: "l", target: "/srv/conn" } });
        raw._extensions = { "posix-rename@openssh.com": "1" };

        const ok = await SFTPAdapter.upload(config, "/tmp/stage", "apps/x/jobs/victim.txt", undefined, undefined, { restoreRelativePath: "x/jobs/victim.txt" });

        expect(ok).toBe(false);
        expect(raw.opens).toEqual([]);
        expect(remote.get("/srv/conn/jobs/victim.txt")?.content).toBe("ORIGINAL");
    });

    it("follows a link below the folder that stays inside it, like a subfolder moved within it", async () => {
        seed({ "/srv/conn/apps/disk2": { kind: "d" }, "/srv/conn/apps/media": { kind: "l", target: "disk2" } });
        raw._extensions = { "posix-rename@openssh.com": "1" };

        const ok = await SFTPAdapter.upload(config, "/tmp/stage", "apps/media/f.txt", undefined, undefined, { restoreRelativePath: "media/f.txt" });

        expect(ok).toBe(true);
        expect(raw.opens).toEqual([{ path: "/srv/conn/apps/media/f.txt", flags: "wx" }]);
    });

    it("refuses a link below a link, the second step of the chain of three restores", async () => {
        seed({ "/srv/conn/apps/d": { kind: "d" }, "/srv/conn/apps/d/p": { kind: "l", target: "/srv/conn/apps" } });

        await expect(SFTPAdapter.createSymlink!(config, "apps/d/p/x", "..", { restoreRelativePath: "d/p/x" })).rejects.toThrow(/symbolic link/);
        expect(raw.symlink).not.toHaveBeenCalled();
    });

    it("lays a link in a real folder of the restore, the first step of that chain alone", async () => {
        seed({});

        await SFTPAdapter.createSymlink!(config, "apps/d/p", "..", { restoreRelativePath: "d/p" });

        expect(remote.get("/srv/conn/apps/d")?.kind).toBe("d");
        expect(raw.symlink).toHaveBeenCalledWith("..", "/srv/conn/apps/d/p", expect.any(Function));
    });

    it("creates the folders of a restore that are not there yet", async () => {
        seed({});
        raw._extensions = { "posix-rename@openssh.com": "1" };

        const ok = await SFTPAdapter.upload(config, "/tmp/stage", "apps/new/sub/f.txt", undefined, undefined, { restoreRelativePath: "new/sub/f.txt" });

        expect(ok).toBe(true);
        expect(remote.get("/srv/conn/apps/new/sub")?.kind).toBe("d");
        expect(remote.get("/srv/conn/apps/new/sub/f.txt")?.kind).toBe("-");
    });
});
