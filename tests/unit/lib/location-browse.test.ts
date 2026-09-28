import { describe, expect, it } from "vitest";
import { locationBrowseOf, locationValue } from "@/lib/adapters/location-browse";

describe("the folder browser of a connection", () => {
    it("is offered for the storage that can list its folders before it is saved", () => {
        for (const id of ["s3-generic", "s3-aws", "s3-r2", "s3-hetzner", "sftp", "ftp", "webdav", "smb", "rsync"]) {
            expect(locationBrowseOf(id), id).not.toBeNull();
        }
        // These pick their folder another way: the disk of the server, an OAuth drive, a volume.
        for (const id of ["local-filesystem", "google-drive", "dropbox", "onedrive", "docker-volume", "mysql"]) {
            expect(locationBrowseOf(id), id).toBeNull();
        }
    });

    it("starts a server at its top and a bucket or share within itself", () => {
        expect(locationBrowseOf("sftp")).toEqual({ root: "/", rooted: true });
        expect(locationBrowseOf("rsync")).toEqual({ root: "/", rooted: true });
        expect(locationBrowseOf("s3-aws")).toEqual({ root: "", rooted: false });
        expect(locationBrowseOf("smb")).toEqual({ root: "", rooted: false });
    });
});

describe("locationValue", () => {
    it("writes a server folder with its leading slash and the top as a slash", () => {
        const sftp = locationBrowseOf("sftp")!;
        expect(locationValue(sftp, "/srv/backups")).toBe("/srv/backups");
        expect(locationValue(sftp, "/")).toBe("/");
    });

    it("writes a prefix of a bucket or a folder of a share without it, the top as nothing", () => {
        const s3 = locationBrowseOf("s3-generic")!;
        expect(locationValue(s3, "/backups/prod")).toBe("backups/prod");
        expect(locationValue(s3, "/")).toBe("");
        expect(locationValue(locationBrowseOf("smb")!, "/server1/mysql")).toBe("server1/mysql");
    });
});
