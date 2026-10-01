import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";
import { getLoginPicture, imageTypeOf, LOGIN_IMAGE_MAX_BYTES, readPublicLoginImage, removeLoginImage, saveLoginImage } from "@/services/system/login-image-service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP"), 1]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const stored = { fileName: "alps.jpg", mimeType: "image/jpeg", size: 6, updatedAt: new Date("2026-10-01T10:00:00.000Z") };

describe("the picture of the login page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.loginImage.upsert.mockResolvedValue(stored as never);
    });

    it("knows a PNG, a JPEG and a WebP by their first bytes, and nothing else", () => {
        expect(imageTypeOf(PNG)).toBe("image/png");
        expect(imageTypeOf(JPEG)).toBe("image/jpeg");
        expect(imageTypeOf(WEBP)).toBe("image/webp");
        expect(imageTypeOf(SVG)).toBeNull();
        expect(imageTypeOf(new Uint8Array([1, 2, 3]))).toBeNull();
    });

    it("refuses an SVG, which could carry a script, whatever its name says", async () => {
        await expect(saveLoginImage("logo.png", SVG)).rejects.toBeInstanceOf(ValidationError);
        expect(prismaMock.loginImage.upsert).not.toHaveBeenCalled();
    });

    it("refuses an empty file and one larger than 5 MB", async () => {
        await expect(saveLoginImage("empty.png", new Uint8Array())).rejects.toThrow("empty");
        await expect(saveLoginImage("huge.png", new Uint8Array(LOGIN_IMAGE_MAX_BYTES + 1))).rejects.toThrow("5 MB");
    });

    it("keeps the type it read and a name without a path", async () => {
        await saveLoginImage("C:\\Users\\manu\\Pictures\\alps.jpg", JPEG);

        expect(prismaMock.loginImage.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "login" },
            create: expect.objectContaining({ fileName: "alps.jpg", mimeType: "image/jpeg", size: JPEG.length }),
        }));
    });

    it("gives the login page the picture with its time, only while Your own image is picked", async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue({ value: "image" } as never);
        prismaMock.loginImage.findUnique.mockResolvedValue(stored as never);
        expect(await getLoginPicture()).toEqual({ src: `/api/login-image?v=${stored.updatedAt.getTime()}` });

        prismaMock.systemSetting.findUnique.mockResolvedValue({ value: "logos" } as never);
        expect(await getLoginPicture()).toBeNull();
        expect(await readPublicLoginImage()).toBeNull();
    });

    it("shows the logos while Your own image is picked but no picture is left", async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue({ value: "image" } as never);
        prismaMock.loginImage.findUnique.mockResolvedValue(null);

        expect(await getLoginPicture()).toBeNull();
    });

    it("goes back to the logos when the picture is removed", async () => {
        prismaMock.$transaction.mockResolvedValue([] as never);

        await removeLoginImage();

        expect(prismaMock.loginImage.deleteMany).toHaveBeenCalled();
        expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "signin.loginLook" }, update: { value: "logos" } }));
    });
});
