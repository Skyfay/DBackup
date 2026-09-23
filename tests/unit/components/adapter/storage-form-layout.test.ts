import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { AUTHORIZED_KEY, LOGIN_KEY, SSH_LOGIN_KEY } from "@/components/adapter/connection-form-layout";
import { storageLayout } from "@/components/adapter/storage-form-layout";

const { DESTINATION, SOURCE } = STORAGE_ROLES;

function adapter(id: string): AdapterDefinition {
    const definition = getAdapterDefinition(id);
    if (!definition) throw new Error(`No adapter ${id}`);
    return definition;
}

const layoutOf = (id: string, role = DESTINATION as typeof DESTINATION | typeof SOURCE, config: Record<string, unknown> = {}) =>
    storageLayout(adapter(id), config, role);
const part = (id: string, section: string, role?: typeof DESTINATION | typeof SOURCE, config?: Record<string, unknown>) =>
    layoutOf(id, role, config).find((entry) => entry.id === section);

describe("storage form parts", () => {
    it("gives an S3 destination its bucket, its folder and the upload settings", () => {
        expect(layoutOf("s3-aws").map((section) => section.id)).toEqual(["connection", "location", "speed", "behavior"]);
        expect(part("s3-aws", "connection")?.expects).toEqual(expect.arrayContaining(["region", "bucket", LOGIN_KEY]));
        expect(part("s3-aws", "speed")?.keys).toEqual(["uploadConcurrency", "uploadPartSizeMb"]);
    });

    it("counts parallel files instead of upload parts once the same storage reads as a source", () => {
        expect(part("s3-aws", "speed", SOURCE)?.keys).toEqual(["maxConcurrentFiles"]);
    });

    it("offers the shadow copy only to an SMB directory source", () => {
        expect(part("smb", "options", SOURCE)?.keys).toContain("useVss");
        expect(part("smb", "options", DESTINATION)?.keys).not.toContain("useVss");
    });

    it("expects the folder where the adapter cannot work without one", () => {
        expect(part("s3-hetzner", "location")?.expects).toEqual(["pathPrefix"]);
        expect(part("rsync", "location")?.expects).toEqual(["pathPrefix"]);
        expect(part("sftp", "location")?.expects).toEqual([]);
    });

    it("waits for a cloud drive's OAuth app to be authorized before its connection counts as done", () => {
        expect(part("google-drive", "connection")?.expects).toEqual(expect.arrayContaining([LOGIN_KEY, AUTHORIZED_KEY]));
        expect(part("dropbox", "location")?.keys).toEqual(["folderPath"]);
    });

    it("keeps the folder of a local destination in its first part", () => {
        expect(layoutOf("local-filesystem").map((section) => section.id)).toEqual(["connection", "behavior"]);
        expect(part("local-filesystem", "connection")?.keys).toContain("basePath");
    });

    it("does not expect a login from an FTP server that allows anonymous access", () => {
        expect(part("ftp", "connection")?.expects).not.toContain(LOGIN_KEY);
    });

    it("splits Docker over SSH into the SSH server and the Docker socket as that server sees it", () => {
        expect(layoutOf("docker-volume", SOURCE).map((section) => section.id)).toEqual(["connection", "options", "speed", "behavior"]);
        const overSsh = layoutOf("docker-volume", SOURCE, { connectionMode: "ssh" });
        expect(overSsh.map((section) => section.id)).toEqual(["connection", "ssh", "service", "options", "speed", "behavior"]);
        expect(overSsh[1].expects).toEqual(["sshHost", SSH_LOGIN_KEY]);
        expect(overSsh[2].keys).toEqual(["socketPath"]);
    });

    it("puts a field that no list names into Options, so a new setting never goes missing", () => {
        const sftp = adapter("sftp");
        const extended = { ...sftp, configSchema: sftp.configSchema.extend({ keepAlive: z.boolean().default(true) }) };
        expect(storageLayout(extended, {}, DESTINATION).find((section) => section.id === "options")?.keys).toContain("keepAlive");
    });
});
