/**
 * The traversal guard for restores written to a storage destination.
 *
 * The paths come from the archive index. On an unencrypted backup that sidecar sits beside
 * the archive and anyone with write access to the destination can edit it, and its
 * contents originally came from a source server - so it is treated as hostile input, the
 * same way local extraction already treats it.
 */
import { describe, it, expect } from "vitest";
import { safeRemoteJoin } from "@/lib/archive/remote-paths";

describe("safeRemoteJoin", () => {
    it("joins an ordinary path below the target", () => {
        expect(safeRemoteJoin("/restore/data", "www/index.php")).toBe("/restore/data/www/index.php");
    });

    it("tolerates a trailing slash on the target", () => {
        expect(safeRemoteJoin("/restore/data/", "a.txt")).toBe("/restore/data/a.txt");
    });

    it("normalises backslashes, since Windows shares spell paths that way", () => {
        expect(safeRemoteJoin("/restore", "sub\\file.txt")).toBe("/restore/sub/file.txt");
    });

    it("keeps an inner .. that stays inside the target", () => {
        expect(safeRemoteJoin("/restore", "a/b/../c.txt")).toBe("/restore/a/c.txt");
    });

    it("refuses a path that climbs out of the target", () => {
        expect(() => safeRemoteJoin("/restore/data", "../../etc/cron.d/evil")).toThrow(/outside the target/i);
    });

    it("refuses a path that climbs out in several steps", () => {
        expect(() => safeRemoteJoin("/restore", "a/../../../../home/user/.ssh/authorized_keys")).toThrow(/outside the target/i);
    });

    it("refuses an absolute path", () => {
        expect(() => safeRemoteJoin("/restore", "/etc/passwd")).toThrow(/absolute/i);
    });

    it("refuses climbing out of an empty target, which addresses the adapter root", () => {
        expect(() => safeRemoteJoin("", "../outside.txt")).toThrow(/outside the target/i);
    });

    it("allows a plain file at the adapter root", () => {
        expect(safeRemoteJoin("", "a.txt")).toBe("a.txt");
    });

    it("is not fooled by a sibling directory sharing the target's name prefix", () => {
        // "/restoreEVIL/x" starts with "/restore" as a string but is not inside it.
        expect(() => safeRemoteJoin("/restore", "../restoreEVIL/x")).toThrow(/outside the target/i);
    });
});
