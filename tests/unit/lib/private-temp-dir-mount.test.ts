/**
 * The private temporary folder on a mount that never shows a folder as 0700 or owned by DBackup,
 * like CIFS, a bind mount of Docker Desktop or NFS with root_squash. The folder this process made
 * is kept for the next calls instead of a new empty one each time, with a warning once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import os from "os";
import path from "path";

let root = "";
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => root }));

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }) },
}));

/** Whether `lstat` shows every folder below `root` as such a mount does, 0777. */
const mount = vi.hoisted(() => ({ hidesMode: true }));
vi.mock("fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs/promises")>();
    const lstat = async (target: string) => {
        const stats = await actual.lstat(target);
        if (!mount.hidesMode || !String(target).startsWith(root) || !stats.isDirectory()) return stats;
        return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { mode: (stats.mode & ~0o777) | 0o777 });
    };
    const patched = { ...actual, lstat };
    return { ...patched, default: patched };
});

const fs = (await vi.importActual<{ default: typeof import("fs/promises") }>("fs/promises")).default;
const { privateTempDir } = await import("@/lib/private-temp-dir");

beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "private-temp-mount-test-"));
});

beforeEach(() => {
    mount.hidesMode = true;
});

afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe.runIf(process.platform !== "win32")("the private temporary folder on a mount that cannot show 0700", () => {
    it("is made once and kept for the next calls, with one warning", async () => {
        const first = await privateTempDir();
        const again = await privateTempDir();
        const third = await privateTempDir();

        expect(again).toBe(first);
        expect(third).toBe(first);
        expect((await fs.readdir(root)).filter((name) => name.startsWith("dbackup-private-"))).toEqual([path.basename(first)]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][1]).toEqual(expect.objectContaining({ folder: root, mode: "777" }));
    });

    it("is made again once a cleaner removed it, and warns no more", async () => {
        const first = await privateTempDir();
        await fs.rm(first, { recursive: true });

        const second = await privateTempDir();

        expect(second).not.toBe(first);
        expect(await privateTempDir()).toBe(second);
        // The mocks are cleared between the tests, the warning of the first one was the only one.
        expect(warn).not.toHaveBeenCalled();
    });
});
