/**
 * An SMB share address has the form smbclient reads, `//server/share` or `\\server\share`, so the
 * local network check names the server smbclient dials and no address reaches it as an option.
 */
import { describe, expect, it } from "vitest";
import { isSmbAddress, parseSmbAddress } from "@/lib/adapters/smb-address";
import { SMBSchema } from "@/lib/adapters/definitions";

const VALID = ["//fileserver/backups", "\\\\10.0.0.9\\share", "//fs.example.com/share/sub/dir", "//fs/My Share", "//fd00::9/share", "//fe80::9%eth0/share", "//file_server-01/share", "\\\\fs\\data@{9f8e7d6c}", "//fs/share/", "//fs/share/sub#1/a@b:c"];
const INVALID = ["fileserver/share", "//fileserver", "//fileserver/", "///fileserver/share", "//fileserver//share", "-L 10.0.0.9", "//-L/share", "smb://fileserver/share", "// fs/share", "", "\\\\fs", "//[fd00::9]/share", "//10.0.0.9#20/share", "//ncacn_ip_tcp:10.0.0.9[135]/share", "//10.0.0.9:445/share", "//user@fs/share", "//fs%x/share"];

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

    it("refuses a semicolon, a double quote or a control character in the server, the share or a folder, which rpcclient reads as part of its command", () => {
        for (const address of ["//fs/share;fss_delete x y z", "//fs;id/share", "//fs/sha\"re", "//fs/share/sub;dir", "//fs/sh\nare", "//fs/sh\u0000are", "//fs/share/sub\u007f"]) {
            expect(isSmbAddress(address), JSON.stringify(address)).toBe(false);
            expect(SMBSchema.safeParse({ address }).success, JSON.stringify(address)).toBe(false);
        }
    });

    it("refuses a folder setting smbclient would read as part of its command, in the form schema", () => {
        for (const pathPrefix of ["backups;put x y", "back\"ups", "back\nups", "back\u0000ups"]) {
            const result = SMBSchema.safeParse({ address: "//fs/share", pathPrefix });
            expect(result.success, JSON.stringify(pathPrefix)).toBe(false);
            expect(result.error?.issues[0].message).toContain("semicolon");
        }
        for (const pathPrefix of [undefined, "", "backups/My Folder", "a'b & c"]) {
            expect(SMBSchema.safeParse({ address: "//fs/share", pathPrefix }).success, String(pathPrefix)).toBe(true);
        }
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
