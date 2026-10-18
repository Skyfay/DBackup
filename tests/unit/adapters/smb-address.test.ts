/**
 * An SMB share address has the form smbclient reads, `//server/share` or `\\server\share`, so the
 * local network check names the server smbclient dials and no address reaches it as an option.
 */
import { describe, expect, it } from "vitest";
import { isSmbAddress, parseSmbAddress } from "@/lib/adapters/smb-address";
import { SMBSchema } from "@/lib/adapters/definitions";

const VALID = ["//fileserver/backups", "\\\\10.0.0.9\\share", "//fs.example.com/share/sub/dir", "//fs/My Share", "//[fd00::9]/share", "\\\\fs\\data@{9f8e7d6c}", "//fs/share/"];
const INVALID = ["fileserver/share", "//fileserver", "//fileserver/", "///fileserver/share", "//fileserver//share", "-L 10.0.0.9", "//-L/share", "smb://fileserver/share", "// fs/share", "", "\\\\fs"];

describe("an SMB share address", () => {
    it("reads //server/share and \\\\server\\share with folders after the share", () => {
        expect(parseSmbAddress("//fileserver/backups/sub")).toEqual({ server: "fileserver", share: "backups" });
        expect(parseSmbAddress("\\\\10.0.0.9\\share")).toEqual({ server: "10.0.0.9", share: "share" });
        for (const address of VALID) expect(isSmbAddress(address), address).toBe(true);
    });

    it("refuses every other form", () => {
        for (const address of INVALID) expect(isSmbAddress(address), address).toBe(false);
        expect(isSmbAddress(undefined)).toBe(false);
    });

    it("is checked by the form schema of a connection", () => {
        for (const address of VALID) expect(SMBSchema.safeParse({ address }).success, address).toBe(true);
        for (const address of INVALID.filter(Boolean)) {
            const result = SMBSchema.safeParse({ address });
            expect(result.success, address).toBe(false);
            expect(result.error?.issues[0].message).toContain("//server/share");
        }
    });
});
