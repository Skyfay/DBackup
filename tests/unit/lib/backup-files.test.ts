import { describe, it, expect } from "vitest";
import {
    isBackupFile,
    isSidecarFile,
    sidecarPathsFor,
    SIDECAR_SUFFIXES,
    METADATA_SIDECAR_SUFFIX,
} from "@/lib/core/backup-files";
import { INDEX_SIDECAR_SUFFIX } from "@/lib/archive/format";

describe("backup file classification", () => {
    it("recognises every sidecar suffix", () => {
        expect(isSidecarFile("backup.tar.meta.json")).toBe(true);
        expect(isSidecarFile("backup.tar.index")).toBe(true);
        expect(isBackupFile("backup.tar.meta.json")).toBe(false);
        expect(isBackupFile("backup.tar.index")).toBe(false);
    });

    it("treats real backups as backups", () => {
        for (const name of [
            "backup.tar",
            "backup.sql.gz",
            "backup.sql.gz.enc",
            "dump.custom",
            "config_backup_2026-07-22.tar.gz",
        ]) {
            expect(isBackupFile(name), name).toBe(true);
        }
    });

    it("lists every sidecar belonging to a backup", () => {
        expect(sidecarPathsFor("job/backup.tar")).toEqual([
            "job/backup.tar.meta.json",
            "job/backup.tar.index",
        ]);
    });

    it("keeps the suffix list and the helpers in sync", () => {
        // A future sidecar must be added to SIDECAR_SUFFIXES and nowhere else. This guards
        // against the failure that motivated this module: the `.index` sidecar was added in
        // v3.0.0 while seven call sites still hard-coded a `.meta.json` check, so an index
        // file counted as a backup - which in retention can delete a real backup.
        expect(SIDECAR_SUFFIXES).toContain(METADATA_SIDECAR_SUFFIX);
        expect(SIDECAR_SUFFIXES).toContain(INDEX_SIDECAR_SUFFIX);
        for (const suffix of SIDECAR_SUFFIXES) {
            expect(isSidecarFile(`anything${suffix}`), suffix).toBe(true);
        }
        expect(sidecarPathsFor("b.tar")).toHaveLength(SIDECAR_SUFFIXES.length);
    });

    it("does not mistake a similar-looking name for a sidecar", () => {
        expect(isBackupFile("index")).toBe(true);
        expect(isBackupFile("meta.json.tar")).toBe(true);
        expect(isBackupFile("my.index.tar")).toBe(true);
    });
});
