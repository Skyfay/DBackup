import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { aliasesOf, rememberKeyFor } from "@/services/vault/key-aliases";

describe("aliasesOf", () => {
    it("reads the ids and leaves out anything else", () => {
        expect(aliasesOf('["a","",3,"b"]')).toEqual(["a", "b"]);
        expect(aliasesOf("not json")).toEqual([]);
        expect(aliasesOf(null)).toEqual([]);
    });
});

describe("rememberKeyFor", () => {
    beforeEach(() => vi.clearAllMocks());

    it("adds the id a backup named to the key that opened it, once", async () => {
        prismaMock.encryptionProfile.findUnique.mockResolvedValue({ aliases: '["old-1"]' } as never);

        await rememberKeyFor("key", "old-2");
        expect(prismaMock.encryptionProfile.update).toHaveBeenCalledWith({ where: { id: "key" }, data: { aliases: '["old-1","old-2"]' } });

        vi.clearAllMocks();
        prismaMock.encryptionProfile.findUnique.mockResolvedValue({ aliases: '["old-1"]' } as never);
        await rememberKeyFor("key", "old-1");
        expect(prismaMock.encryptionProfile.update).not.toHaveBeenCalled();
    });

    it("skips the own id and no id at all", async () => {
        await rememberKeyFor("key", "key");
        await rememberKeyFor("key", undefined);
        expect(prismaMock.encryptionProfile.findUnique).not.toHaveBeenCalled();
    });

    it("never fails the restore that found the match", async () => {
        prismaMock.encryptionProfile.findUnique.mockRejectedValue(new Error("database is locked"));

        await expect(rememberKeyFor("key", "old")).resolves.toBeUndefined();
    });
});
