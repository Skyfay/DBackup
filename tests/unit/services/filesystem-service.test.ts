import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";

const fsMock = vi.hoisted(() => ({ stat: vi.fn(), readdir: vi.fn(), realpath: vi.fn() }));
vi.mock("fs/promises", () => ({ default: fsMock, ...fsMock }));

const sftp = vi.hoisted(() => ({ connect: vi.fn(), exists: vi.fn(), list: vi.fn(), end: vi.fn() }));
vi.mock("ssh2-sftp-client", () => ({
    default: class {
        connect = sftp.connect;
        exists = sftp.exists;
        list = sftp.list;
        end = sftp.end;
    },
}));

vi.mock("@/lib/adapters/config-resolver", () => ({ overlayCredentialsOnConfig: vi.fn() }));

import { BlockedPathError, listLocalDirectory, listRemoteDirectory } from "@/services/system/filesystem-service";

const dirent = (name: string, directory: boolean) => ({ name, isDirectory: () => directory });
const folder = { isDirectory: () => true, size: 4096, mtime: new Date("2026-09-20T08:00:00Z") };
const file = (size: number) => ({ isDirectory: () => false, size, mtime: new Date("2026-09-22T09:12:00Z") });

describe("filesystem service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fsMock.realpath.mockImplementation(async (target: string) => target);
        sftp.end.mockResolvedValue(undefined);
    });

    describe("listLocalDirectory", () => {
        it("lists folders first with the size and date of every file, and opens a link to a folder as one", async () => {
            fsMock.readdir.mockResolvedValue([dirent("shop.db", false), dirent("archive", true), dirent("current", false)]);
            fsMock.stat.mockImplementation(async (target: string) => {
                if (target === "/data" || target === "/data/archive" || target === "/data/current") return folder;
                return file(48_200_000);
            });

            const listing = await listLocalDirectory("/data");

            expect(listing.currentPath).toBe("/data");
            expect(listing.parentPath).toBe("/");
            expect(listing.entries).toEqual([
                { name: "archive", type: "directory", path: "/data/archive", modified: "2026-09-20T08:00:00.000Z" },
                { name: "current", type: "directory", path: "/data/current", modified: "2026-09-20T08:00:00.000Z" },
                { name: "shop.db", type: "file", path: "/data/shop.db", size: 48_200_000, modified: "2026-09-22T09:12:00.000Z" },
            ]);
        });

        it("refuses a blocked system path", async () => {
            await expect(listLocalDirectory("/proc/1")).rejects.toBeInstanceOf(BlockedPathError);
            expect(fsMock.readdir).not.toHaveBeenCalled();
        });

        it("refuses a link that leads into a blocked system path", async () => {
            fsMock.realpath.mockResolvedValue("/private/var/db/secrets");

            await expect(listLocalDirectory("/var/db/secrets")).rejects.toBeInstanceOf(BlockedPathError);
            expect(fsMock.readdir).not.toHaveBeenCalled();
        });

        it("says when a path is missing or is a file", async () => {
            fsMock.stat.mockRejectedValueOnce(new Error("ENOENT"));
            await expect(listLocalDirectory("/gone")).rejects.toBeInstanceOf(NotFoundError);

            fsMock.stat.mockResolvedValueOnce(file(10));
            await expect(listLocalDirectory("/data/shop.db")).rejects.toBeInstanceOf(ValidationError);
        });
    });

    describe("listRemoteDirectory", () => {
        const config = { host: "db01.internal", port: 22, username: "backup", password: "secret" };

        it("lists a server folder with sizes and dates and closes the connection", async () => {
            sftp.exists.mockResolvedValue("d");
            sftp.list.mockResolvedValue([
                { name: "shop.db", type: "-", size: 1024, modifyTime: Date.parse("2026-09-22T09:12:00Z") },
                { name: "archive", type: "d", size: 4096, modifyTime: Date.parse("2026-09-20T08:00:00Z") },
            ]);

            const listing = await listRemoteDirectory({ config, path: "/srv/data/" });

            expect(listing.entries).toEqual([
                { name: "archive", type: "directory", path: "/srv/data/archive", modified: "2026-09-20T08:00:00.000Z" },
                { name: "shop.db", type: "file", path: "/srv/data/shop.db", size: 1024, modified: "2026-09-22T09:12:00.000Z" },
            ]);
            expect(listing.parentPath).toBe("/srv");
            expect(sftp.end).toHaveBeenCalled();
        });

        it("refuses to list a file and still closes the connection", async () => {
            sftp.exists.mockResolvedValue("-");

            await expect(listRemoteDirectory({ config, path: "/srv/data/shop.db" })).rejects.toBeInstanceOf(ValidationError);
            expect(sftp.list).not.toHaveBeenCalled();
            expect(sftp.end).toHaveBeenCalled();
        });

        it("asks for a host before it connects", async () => {
            await expect(listRemoteDirectory({ config: {}, path: "/" })).rejects.toBeInstanceOf(ValidationError);
            expect(sftp.connect).not.toHaveBeenCalled();
        });
    });
});
