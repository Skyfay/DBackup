/**
 * The saved login of a destination shared with customers opens the folder of their backups, under
 * any spelling of the address and through any kind of connection or form. So it signs in on that
 * destination alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const db = vi.hoisted(() => ({
    shareFindFirst: vi.fn(),
    configFindUnique: vi.fn(),
    configFindFirst: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({
    default: {
        connectionShare: { findFirst: (...args: unknown[]) => db.shareFindFirst(...args) },
        adapterConfig: {
            findUnique: (...args: unknown[]) => db.configFindUnique(...args),
            findFirst: (...args: unknown[]) => db.configFindFirst(...args),
        },
    },
}));

const sftp = vi.hoisted(() => ({ connect: vi.fn(), list: vi.fn() }));
vi.mock("ssh2-sftp-client", () => ({
    default: class {
        connect = sftp.connect;
        exists = vi.fn();
        list = sftp.list;
        end = vi.fn().mockResolvedValue(undefined);
    },
}));
const overlay = vi.hoisted(() => vi.fn());
vi.mock("@/lib/adapters/config-resolver", () => ({ overlayCredentialsOnConfig: overlay }));

const { assertOffSharedLogins, assertSharedLoginsAlone } = await import("@/services/adapters/shared-login");
const { listRemoteDirectory } = await import("@/services/system/filesystem-service");
const { placesOverlap, storagePlaceOf } = await import("@/lib/adapters/storage-place");

/** The shared destination "NAS" signs in with the saved login `nas-key`. */
function shareUses(...loginIds: string[]) {
    db.shareFindFirst.mockImplementation(async ({ where }: { where: { id?: { not: string }; config: { OR: { primaryCredentialId?: { in: string[] }; sshCredentialId?: { in: string[] } }[] } } }) => {
        if (where.id?.not === "nas") return null;
        const asked = where.config.OR.flatMap((part) => part.primaryCredentialId?.in ?? part.sshCredentialId?.in ?? []);
        return asked.some((id) => loginIds.includes(id)) ? { id: "nas" } : null;
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    shareUses("nas-key");
    db.configFindUnique.mockResolvedValue(null);
    db.configFindFirst.mockResolvedValue(null);
});

describe("the saved login of a destination shared with customers", () => {
    it("is refused for a second connection, whichever slot names it and whatever the address reads", async () => {
        await expect(assertOffSharedLogins({ primaryCredentialId: "nas-key" })).rejects.toBeInstanceOf(ValidationError);
        await expect(assertOffSharedLogins({ sshCredentialId: "nas-key" })).rejects.toThrow("signs in to a destination shared with customers");
    });

    it("stays free for a login no shared destination uses, and asks nothing without one", async () => {
        await expect(assertOffSharedLogins({ primaryCredentialId: "other" })).resolves.toBeUndefined();
        await expect(assertOffSharedLogins({})).resolves.toBeUndefined();
        expect(db.shareFindFirst).toHaveBeenCalledTimes(1);
    });

    it("stays with the shared destination itself and with a connection that held it before", async () => {
        await expect(assertOffSharedLogins({ primaryCredentialId: "nas-key" }, "nas")).resolves.toBeUndefined();

        db.configFindUnique.mockResolvedValue({ primaryCredentialId: null, sshCredentialId: "nas-key" });
        await expect(assertOffSharedLogins({ sshCredentialId: "nas-key" }, "old-source")).resolves.toBeUndefined();
        // Another connection that is being edited does not get it.
        db.configFindUnique.mockResolvedValue({ primaryCredentialId: "own", sshCredentialId: null });
        await expect(assertOffSharedLogins({ primaryCredentialId: "nas-key" }, "other-destination")).rejects.toBeInstanceOf(ValidationError);
    });

    it("keeps a destination from being shared while another connection signs in with its login", async () => {
        db.configFindFirst.mockResolvedValue({ name: "SQLite on the NAS" });

        await expect(assertSharedLoginsAlone({ id: "nas", name: "NAS", primaryCredentialId: "nas-key", sshCredentialId: null }))
            .rejects.toThrow("SQLite on the NAS signs in with a saved login of NAS");
        expect(db.configFindFirst.mock.calls[0][0].where.id).toEqual({ not: "nas" });

        db.configFindFirst.mockResolvedValue(null);
        await expect(assertSharedLoginsAlone({ id: "nas", name: "NAS", primaryCredentialId: "nas-key" })).resolves.toBeUndefined();
        await expect(assertSharedLoginsAlone({ id: "nas", name: "NAS" })).resolves.toBeUndefined();
    });

    it("lists no folder of its server through the remote file browser of a database form", async () => {
        await expect(listRemoteDirectory({ adapterId: "sqlite", sshCredentialId: "nas-key", config: { mode: "ssh", host: "127.0.0.1" }, path: "/data/tenants" }))
            .rejects.toThrow("signs in to a destination shared with customers");
        expect(overlay).not.toHaveBeenCalled();
        expect(sftp.connect).not.toHaveBeenCalled();
    });
});

describe("two spellings of the server of a shared destination", () => {
    const shared = storagePlaceOf("sftp", { host: "nas.example.com", pathPrefix: "/backups" })!;

    it("count as one storage with a dot at the end, in another case and under every name of the loopback", () => {
        expect(placesOverlap(shared, storagePlaceOf("sftp", { host: "NAS.example.com.", pathPrefix: "/backups/tenants" })!)).toBe(true);
        const loopback = storagePlaceOf("sftp", { host: "127.0.0.1", pathPrefix: "/srv" })!;
        expect(placesOverlap(loopback, storagePlaceOf("rsync", { host: "localhost", pathPrefix: "/srv/tenants" })!)).toBe(true);
        expect(placesOverlap(loopback, storagePlaceOf("sftp", { host: "[::1]", pathPrefix: "/srv/tenants" })!)).toBe(true);
    });

    it("stay two storages for another server", () => {
        expect(placesOverlap(shared, storagePlaceOf("sftp", { host: "nas2.example.com", pathPrefix: "/backups/tenants" })!)).toBe(false);
    });
});
