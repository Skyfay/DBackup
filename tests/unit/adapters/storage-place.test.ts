// @vitest-environment node
import { describe, expect, it } from "vitest";
import { placesOverlap, storagePlaceOf } from "@/lib/adapters/storage-place";

const overlap = (a: [string, Record<string, unknown>], b: [string, Record<string, unknown>]) => {
    const first = storagePlaceOf(...a);
    const second = storagePlaceOf(...b);
    if (!first || !second) throw new Error("A place did not read");
    return placesOverlap(first, second);
};

describe("where a storage connection keeps its files", () => {
    it("overlaps the same folder, one inside it and one above it, never a sibling", () => {
        const shared: [string, Record<string, unknown>] = ["s3-generic", { endpoint: "https://s3.example.com", bucket: "vault", pathPrefix: "/backups" }];
        expect(overlap(shared, ["s3-generic", { endpoint: "s3.example.com", bucket: "vault", pathPrefix: "backups/" }])).toBe(true);
        expect(overlap(shared, ["s3-generic", { endpoint: "https://S3.example.com:443", bucket: "vault", pathPrefix: "backups/tenants/acme" }])).toBe(true);
        expect(overlap(shared, ["s3-generic", { endpoint: "https://s3.example.com", bucket: "vault" }])).toBe(true);
        expect(overlap(shared, ["s3-generic", { endpoint: "https://s3.example.com", bucket: "vault", pathPrefix: "backups2" }])).toBe(false);
        expect(overlap(shared, ["s3-generic", { endpoint: "https://s3.example.com", bucket: "other", pathPrefix: "backups" }])).toBe(false);
    });

    it("counts Amazon S3 and a generic S3 pointed at Amazon as one storage, by the bucket", () => {
        expect(overlap(["s3-aws", { region: "eu-central-1", bucket: "vault" }], ["s3-generic", { endpoint: "https://s3.eu-central-1.amazonaws.com", bucket: "vault", pathPrefix: "x" }])).toBe(true);
        expect(overlap(["s3-r2", { accountId: "ABC", bucket: "vault" }], ["s3-generic", { endpoint: "https://abc.r2.cloudflarestorage.com", bucket: "vault" }])).toBe(true);
        expect(overlap(["s3-hetzner", { region: "fsn1", bucket: "vault", pathPrefix: "a" }], ["s3-hetzner", { region: "nbg1", bucket: "vault", pathPrefix: "a" }])).toBe(false);
    });

    it("counts SFTP and rsync on one server as one storage, a relative folder in the home of its account", () => {
        expect(overlap(["sftp", { host: "nas", username: "backup", pathPrefix: "/srv/backups" }], ["rsync", { host: "NAS", username: "other", pathPrefix: "/srv" }])).toBe(true);
        expect(overlap(["sftp", { host: "nas", username: "backup", pathPrefix: "backups" }], ["sftp", { host: "nas", username: "backup", pathPrefix: "" }])).toBe(true);
        expect(overlap(["sftp", { host: "nas", username: "backup", pathPrefix: "backups" }], ["sftp", { host: "nas", username: "alice", pathPrefix: "" }])).toBe(false);
        expect(overlap(["ftp", { host: "nas", username: "backup", pathPrefix: "/a" }], ["sftp", { host: "nas", username: "backup", pathPrefix: "/a" }])).toBe(false);
    });

    it("reads an SMB share without minding case, its folder from the address and the prefix", () => {
        expect(overlap(["smb", { address: "//FileServer/Backups/Sub", pathPrefix: "x" }], ["smb", { address: "\\\\fileserver\\backups", pathPrefix: "sub" }])).toBe(true);
        expect(overlap(["smb", { address: "//fileserver/backups" }], ["smb", { address: "//fileserver/other" }])).toBe(false);
        expect(storagePlaceOf("smb", { address: "//fileserver" })).toBeNull();
    });

    it("reads the folder of a WebDAV URL and its prefix together", () => {
        expect(overlap(["webdav", { url: "https://cloud.example.com/dav/files/me/", pathPrefix: "backups" }], ["webdav", { url: "https://cloud.example.com/dav/files/me/backups/tenants" }])).toBe(true);
        expect(overlap(["webdav", { url: "https://cloud.example.com/dav/files/me/" }], ["webdav", { url: "https://cloud.example.com/dav/files/you/" }])).toBe(false);
        expect(storagePlaceOf("webdav", { url: "not a url" })).toBeNull();
    });

    it("compares a cloud drive by the app and the folder, the top of Google Drive holding every folder", () => {
        expect(overlap(["dropbox", { clientId: "app", folderPath: "/backups" }], ["dropbox", { clientId: "app", folderPath: "/backups/tenants" }])).toBe(true);
        expect(overlap(["dropbox", { clientId: "app", folderPath: "/backups" }], ["dropbox", { clientId: "other-app", folderPath: "/backups" }])).toBe(false);
        expect(overlap(["google-drive", { clientId: "app", folderId: "f1" }], ["google-drive", { clientId: "app" }])).toBe(true);
        expect(overlap(["google-drive", { clientId: "app", folderId: "f1" }], ["google-drive", { clientId: "app", folderId: "f2" }])).toBe(false);
    });

    it("reads the local filesystem as one storage of the server", () => {
        expect(overlap(["local-filesystem", { basePath: "/backups" }], ["local-filesystem", { basePath: "/backups/../backups/tenants" }])).toBe(true);
        expect(overlap(["local-filesystem", { basePath: "/backups" }], ["local-filesystem", { basePath: "/data" }])).toBe(false);
    });

    it("has no place for what keeps no files of its own and for a config without its storage", () => {
        expect(storagePlaceOf("docker-volume", { connectionMode: "ssh", sshHost: "docker" })).toBeNull();
        expect(storagePlaceOf("postgres", { host: "db" })).toBeNull();
        expect(storagePlaceOf("sftp", { pathPrefix: "/a" })).toBeNull();
        expect(storagePlaceOf("s3-generic", { endpoint: "https://s3.example.com" })).toBeNull();
    });
});
