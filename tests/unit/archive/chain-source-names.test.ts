/**
 * The archives of an incremental chain are named by the index of the snapshot, which whoever
 * writes the destination can edit. A name that is a path would read any file the connection
 * reaches and restore it as part of the backup.
 */
import { describe, expect, it, vi } from "vitest";
import { openChainArchive, siblingArchivePath } from "@/lib/archive/chain-source";

describe("a sibling archive of a backup chain", () => {
    it("lies next to the snapshot", () => {
        expect(siblingArchivePath("Files/inc-003.tar", "full-001.tar")).toBe("Files/full-001.tar");
        expect(siblingArchivePath("inc-003.tar", "full-001.tar")).toBe("full-001.tar");
    });

    it.each(["../other-job/full-001.tar", "/etc/shadow", "sub/full-001.tar", "..\\x.tar", "..", ""])(
        "is never the path %j the index names",
        (name) => {
            expect(() => siblingArchivePath("Files/inc-003.tar", name)).toThrow(/Refusing/);
        }
    );

    it("is refused before anything is read from the destination", async () => {
        const download = vi.fn();
        const downloadRange = vi.fn();
        const adapter = { download, downloadRange } as never;

        await expect(openChainArchive({ adapter, config: {} as never, snapshotPath: "Files/inc-003.tar", resolveMasterKey: vi.fn() }, "../../secret.tar"))
            .rejects.toThrow(/Refusing/);
        expect(download).not.toHaveBeenCalled();
        expect(downloadRange).not.toHaveBeenCalled();
    });
});
