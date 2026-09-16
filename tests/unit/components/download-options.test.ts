import { describe, it, expect } from "vitest";
import { getDownloadOptions } from "@/components/dashboard/storage/download-options";

describe("download options of a backup row", () => {
    it("offers the stored file and its decrypted form for an older encrypted backup", () => {
        expect(getDownloadOptions({ isEncrypted: true, dbInfo: { count: 3, label: "3 DBs" } })).toEqual({
            raw: { label: "Download Encrypted (.enc)" },
            decrypted: { label: "Download Decrypted" },
        });
    });

    it("offers only the file itself for an older unencrypted backup", () => {
        expect(getDownloadOptions({ dbInfo: { count: 1, label: "Single DB" } })).toEqual({ raw: { label: "Download" } });
    });

    it("offers the dump itself for a seekable backup of a single database", () => {
        const options = getDownloadOptions({ hasFileIndex: true, isEncrypted: true, dbInfo: { count: 1, label: "Single DB" } });

        expect(options.decrypted).toEqual({ label: "Download Decrypted Dump" });
        expect(options.pickDatabase).toBeUndefined();
        expect(options.contents).toBeUndefined();
        expect(options.raw.label).toBe("Download Encrypted Archive");
    });

    it("offers a database picker and the contents for a seekable backup of several databases", () => {
        const options = getDownloadOptions({ hasFileIndex: true, dbInfo: { count: 12, label: "12 DBs" } });

        expect(options.decrypted).toBeUndefined();
        expect(options.pickDatabase).toEqual({ label: "Download Database..." });
        expect(options.contents).toEqual({ label: "Download Contents" });
        expect(options.raw.label).toBe("Download Archive (.tar)");
    });

    it("offers the picker for a single database that sits next to files", () => {
        const options = getDownloadOptions({
            hasFileIndex: true,
            isEncrypted: true,
            combined: { databases: 1, directorySources: 2 },
        });

        expect(options.decrypted).toBeUndefined();
        expect(options.pickDatabase).toBeDefined();
        expect(options.contents).toEqual({ label: "Download Decrypted Contents" });
    });

    it("offers no database picker for a backup of files only", () => {
        const options = getDownloadOptions({ hasFileIndex: true, combined: { databases: 0, directorySources: 1 }, chain: { index: 2 } });

        expect(options.pickDatabase).toBeUndefined();
        expect(options.decrypted).toBeUndefined();
        expect(options.contents).toEqual({ label: "Download Complete Snapshot" });
    });
});
