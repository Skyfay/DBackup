// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { importAvatarFiles, legacyAvatarFile } from "@/services/user/avatar-import";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let root = "";
let dataDir = "";
let appDir = "";

describe("moving the pictures of earlier versions into the database", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        root = mkdtempSync(path.join(os.tmpdir(), "dbackup-avatars-"));
        dataDir = path.join(root, "data");
        appDir = path.join(root, "app");
        mkdirSync(path.join(dataDir, "storage", "avatars"), { recursive: true });
        mkdirSync(path.join(appDir, "public", "uploads", "avatars"), { recursive: true });
        prismaMock.$transaction.mockResolvedValue([] as never);
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it("reads only the addresses of files, never those in the database or of a provider", () => {
        expect(legacyAvatarFile("/api/avatar/u1-1727000000000.png")).toBe("u1-1727000000000.png");
        expect(legacyAvatarFile("/uploads/avatars/u1-1600000000000.jpg")).toBe("u1-1600000000000.jpg");
        expect(legacyAvatarFile("/api/avatar/u1?v=1790000000000")).toBeNull();
        expect(legacyAvatarFile("https://auth.example.ch/picture/u1.png")).toBeNull();
        expect(legacyAvatarFile("/api/avatar/../../etc/passwd")).toBeNull();
        expect(legacyAvatarFile(null)).toBeNull();
    });

    it("moves every picture in, drops the address of a lost one and removes the empty folders", async () => {
        writeFileSync(path.join(dataDir, "storage", "avatars", "u1-1727000000000.png"), PNG);
        writeFileSync(path.join(dataDir, "storage", "avatars", "old-leftover.png"), PNG);
        writeFileSync(path.join(appDir, "public", "uploads", "avatars", "u2-1600000000000.png"), PNG);
        prismaMock.user.findMany.mockResolvedValue([
            { id: "u1", image: "/api/avatar/u1-1727000000000.png" },
            { id: "u2", image: "/uploads/avatars/u2-1600000000000.png" },
            { id: "u3", image: "/api/avatar/u3-1727000000001.png" },
            { id: "u4", image: "/api/avatar/u4?v=1790000000000" },
        ] as never);

        await importAvatarFiles(dataDir, appDir);

        const stored = prismaMock.avatar.upsert.mock.calls.map(([call]) => call.where.userId);
        expect(stored).toEqual(["u1", "u2"]);
        expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u3" }, data: { image: null } });
        expect(prismaMock.user.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u4" } }));
        expect(existsSync(path.join(dataDir, "storage"))).toBe(false);
        // The folder of the app is only read, it belongs to the image.
        expect(existsSync(path.join(appDir, "public", "uploads", "avatars", "u2-1600000000000.png"))).toBe(true);
    });

    it("keeps the folder above while something else lies in it", async () => {
        writeFileSync(path.join(dataDir, "storage", "notes.txt"), "mine");
        prismaMock.user.findMany.mockResolvedValue([] as never);

        await importAvatarFiles(dataDir, appDir);

        expect(existsSync(path.join(dataDir, "storage", "avatars"))).toBe(false);
        expect(existsSync(path.join(dataDir, "storage", "notes.txt"))).toBe(true);
    });

    it("keeps every file for the next start when a picture cannot be stored", async () => {
        writeFileSync(path.join(dataDir, "storage", "avatars", "u1-1727000000000.png"), PNG);
        prismaMock.user.findMany.mockResolvedValue([{ id: "u1", image: "/api/avatar/u1-1727000000000.png" }] as never);
        prismaMock.$transaction.mockRejectedValueOnce(new Error("database is locked"));

        await expect(importAvatarFiles(dataDir, appDir)).resolves.toBeUndefined();

        expect(existsSync(path.join(dataDir, "storage", "avatars", "u1-1727000000000.png"))).toBe(true);
    });
});
