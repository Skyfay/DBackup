import { describe, expect, it } from "vitest";
import { CHAIN_FOLDER_NAME, chainFolderOf } from "@/lib/core/backup-files";
import { chainDirName } from "@/services/backup/chain-planner";

describe("the name of a chain folder", () => {
    it("is the one the runner gives a new chain", () => {
        const folder = chainDirName(new Date("2026-11-10T16:49:38.123Z"));

        expect(folder).toBe("chain-2026-11-10T16-49-38-123");
        expect(CHAIN_FOLDER_NAME.test(folder)).toBe(true);
        expect(chainFolderOf(`backups/nightly/${folder}/inc-001.tar.gz`)).toBe(`backups/nightly/${folder}`);
    });

    it("is never the folder of a job that is itself called chain-something", () => {
        expect(chainFolderOf("tenants/acme/chain-store/db.sql.gz")).toBeNull();
        expect(chainFolderOf("/chain-2026/db.sql.gz")).toBeNull();
        // A chain sits inside the folder of its job, never at the root of the destination.
        expect(chainFolderOf("chain-2026-11-10T16-49-38-123/full-000.tar.gz")).toBeNull();
    });
});
