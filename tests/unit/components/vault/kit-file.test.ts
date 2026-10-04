// @vitest-environment node
// The kit is read the way a browser reads it, with Blob streams and DecompressionStream, which
// jsdom does not have. The zips come from the builder of the real kit.
import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { keysFromFile } from "@/components/dashboard/vault/kit-file";
import { buildRecoveryKit } from "@/services/backup/recovery-kit";

const KEY = "ab".repeat(32);
const SECOND = "cd".repeat(32);

async function kitFile(profiles: { id: string; name: string; masterKeyHex: string }[]) {
    const bytes = await buildRecoveryKit({ profiles, generatedAt: "2026-09-27T12:00:00.000Z" });
    return new File([new Uint8Array(bytes)], "recovery_kit.zip", { type: "application/zip" });
}

describe("keysFromFile", () => {
    it("reads the key and its name out of the kit of one key", async () => {
        expect(await keysFromFile(await kitFile([{ id: "p1", name: "Production", masterKeyHex: KEY }]))).toEqual([{ name: "Production", profileId: "p1", key: KEY }]);
    });

    it("reads every key of a kit with several, named from its index", async () => {
        const keys = await keysFromFile(await kitFile([
            { id: "p1", name: "Production", masterKeyHex: KEY },
            { id: "p2", name: "Legacy 2024 / old", masterKeyHex: SECOND },
        ]));

        expect(keys).toHaveLength(2);
        expect(keys).toEqual(expect.arrayContaining([
            { name: "Production", profileId: "p1", key: KEY },
            { name: "Legacy 2024 / old", profileId: "p2", key: SECOND },
        ]));
    });

    it("reads a zip whose files are stored without packing", async () => {
        const zip = new AdmZip();
        zip.addFile("master.key", Buffer.from(KEY));
        zip.getEntries()[0].header.method = 0;
        const file = new File([new Uint8Array(zip.toBuffer())], "kit.zip");

        expect(await keysFromFile(file)).toEqual([{ name: null, profileId: null, key: KEY }]);
    });

    it("takes a .key file on its own and names the key after it", async () => {
        expect(await keysFromFile(new File([`${KEY}\n`], "Production.key"))).toEqual([{ name: "Production", profileId: null, key: KEY }]);
        expect(await keysFromFile(new File([KEY], "master.key"))).toEqual([{ name: null, profileId: null, key: KEY }]);
    });

    it("says so when a file holds no key", async () => {
        await expect(keysFromFile(new File(["hello"], "notes.txt"))).rejects.toThrow("This file holds no key");
        const zip = new AdmZip();
        zip.addFile("README.txt", Buffer.from("nothing here"));
        await expect(keysFromFile(new File([new Uint8Array(zip.toBuffer())], "other.zip"))).rejects.toThrow("This zip holds no key");
    });
});
