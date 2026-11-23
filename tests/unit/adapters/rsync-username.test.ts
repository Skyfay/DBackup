/**
 * The username of an rsync login is a plain login name: rsync puts it in front of the host,
 * `user@host:path`, and OpenSSH reads `user@host`, so a name with `:` or `/` would make them dial
 * another host and one with a leading `-` would reach OpenSSH as an option. Both read the host
 * after the last `@`, so an AD login like `alice@corp.local` still reaches the configured host.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rsyncUsernameProblem } from "@/lib/adapters/storage/rsync-user";
import { RsyncSchema } from "@/lib/adapters/definitions";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), decrypted: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { credentialProfile: { findUnique: mocks.findUnique } } }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: mocks.decrypted }));

const { validateCredentialAssignments } = await import("@/lib/adapters/credential-validation");
const { registerAdapters } = await import("@/lib/adapters");
registerAdapters();

const REFUSED = ["ops:x", "ops@10.0.0.5:22", "ops/x", "back up", "tab\there", "line\nbreak", "-oProxyCommand=x", "-l"];
const PLAIN = ["backup", "backup-01", "backup.ops", "svc_backup", "Backup01", "dbackup$", "alice@corp.local", "CORP\\alice"];

const config = { host: "nas.example.com", port: 22, authType: "password", password: "pw", pathPrefix: "/backups" };

describe("the username of an rsync login", () => {
    it("refuses :, /, whitespace, control characters and a leading -", () => {
        for (const username of REFUSED) expect(rsyncUsernameProblem(username), username).not.toBeNull();
    });

    it("takes a plain login name, with dots, dashes, underscores and an @ of a Windows login inside", () => {
        for (const username of PLAIN) expect(rsyncUsernameProblem(username), username).toBeNull();
    });

    it("is checked by the form schema of a connection", () => {
        for (const username of REFUSED) expect(RsyncSchema.safeParse({ ...config, username }).success, username).toBe(false);
        for (const username of PLAIN) expect(RsyncSchema.safeParse({ ...config, username }).success, username).toBe(true);
    });

    describe("of a saved login assigned to an rsync connection", () => {
        beforeEach(() => {
            mocks.findUnique.mockResolvedValue({ id: "login-1", type: "SSH_KEY" });
        });

        it("refuses a profile whose username is no plain name", async () => {
            mocks.decrypted.mockResolvedValue({ username: "ops:10.0.0.5", authType: "password", password: "pw" });
            await expect(validateCredentialAssignments("rsync", "login-1", null)).rejects.toBeInstanceOf(ValidationError);
        });

        it("takes a profile with a plain name, and leaves the SSH logins of other adapters alone", async () => {
            mocks.decrypted.mockResolvedValue({ username: "backup-01", authType: "password", password: "pw" });
            await expect(validateCredentialAssignments("rsync", "login-1", null)).resolves.toBeUndefined();

            mocks.decrypted.mockClear();
            await expect(validateCredentialAssignments("sftp", "login-1", null)).resolves.toBeUndefined();
            expect(mocks.decrypted).not.toHaveBeenCalled();
        });
    });
});
