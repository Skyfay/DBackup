import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";
import { AVATAR_MAX_BYTES, avatarUrl, findAvatar, removeAvatar, saveAvatar } from "@/services/user/avatar-service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("the pictures of the people", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00.000Z"), toFake: ["Date"] });
        prismaMock.$transaction.mockResolvedValue([] as never);
    });

    afterEach(() => vi.useRealTimers());

    it("keeps a picture with the type it read and points the person at it with its time", async () => {
        const url = await saveAvatar("u1", PNG);

        expect(url).toBe(`/api/avatar/u1?v=${new Date("2026-10-01T12:00:00.000Z").getTime()}`);
        expect(prismaMock.avatar.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: "u1" },
            create: expect.objectContaining({ userId: "u1", mimeType: "image/png", size: PNG.length }),
        }));
        expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { image: url } });
        // The picture and the address change together or not at all.
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("refuses an SVG whatever its name, an empty file and one larger than 5 MB", async () => {
        await expect(saveAvatar("u1", SVG)).rejects.toBeInstanceOf(ValidationError);
        await expect(saveAvatar("u1", new Uint8Array())).rejects.toThrow("empty");
        await expect(saveAvatar("u1", new Uint8Array(AVATAR_MAX_BYTES + 1))).rejects.toThrow("5 MB");
        expect(prismaMock.avatar.upsert).not.toHaveBeenCalled();
    });

    it("removes the picture and the address together", async () => {
        await removeAvatar("u1");

        expect(prismaMock.avatar.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
        expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { image: null } });
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("finds a picture by the id, and by a file name of the versions that kept files", async () => {
        prismaMock.avatar.findUnique.mockImplementation((async ({ where }: { where: { userId: string } }) =>
            where.userId === "u1" ? { data: Buffer.from(PNG), mimeType: "image/png" } : null) as never);

        expect(await findAvatar("u1")).toEqual({ data: PNG, mimeType: "image/png" });
        expect(await findAvatar("u1-1727000000000.png")).toEqual({ data: PNG, mimeType: "image/png" });
        expect(await findAvatar("u2")).toBeNull();
        expect(avatarUrl("u 1", new Date(5))).toBe("/api/avatar/u%201?v=5");
    });
});
