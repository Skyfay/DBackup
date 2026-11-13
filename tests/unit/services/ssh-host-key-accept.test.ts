import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({
    /** The key the server presents at the one login of an accept, null for a server that does not let DBackup in. */
    presents: null as { type: string; key: string; fingerprint: string } | null,
    hostLocal: vi.fn(),
    check: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => {
    const child = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { logger: { ...child, child: () => child } };
});
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ id: "sftp", ping: vi.fn() }) } }));
vi.mock("@/lib/crypto", () => ({ decryptConfig: (config: unknown) => config }));
vi.mock("@/lib/tenant/context", () => ({ runAsTenant: (_tenant: string, run: () => unknown) => run() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn(async (row: { config: string }) => JSON.parse(row.config)) }));
vi.mock("@/services/adapters/adapter-create", () => ({ assertMayManageHostLocal: mocks.hostLocal }));
vi.mock("@/lib/transport/adapter-invoke", () => ({ runConnectivityCheck: mocks.check }));

import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { parseMetadata, storedPin, withPin } from "@/lib/adapters/ssh-host-key-pins";
import { hostKeyFingerprint, hostKeyOf } from "@/lib/transport/host-key";
import { auditService } from "@/services/audit-service";
import { acceptHostKey, forgetHostKey } from "@/services/adapters/ssh-host-key-accept";
import { HOST_KEY_AUDIT } from "@/services/adapters/ssh-host-key-service";

const keyOf = (text: string) => {
    const key = Buffer.from(text).toString("base64");
    return { type: "ssh-ed25519", key, fingerprint: hostKeyFingerprint(Buffer.from(key, "base64")) };
};
const oldKey = keyOf("the key before the reinstall");
const newKey = keyOf("the key after the reinstall");
const thirdKey = keyOf("the key of whoever answers a moment later");
const endpoint = { host: "sftp.example.test", port: 22 };
const pinOf = (key: typeof oldKey) => ({ ...endpoint, ...key, pinnedAt: "2026-11-01T10:00:00.000Z", pinnedBy: "first-connect" as const });
const lena = { userId: "u-lena" };

let row: Record<string, unknown> & { metadata: string | null } | null;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.presents = newKey;
    mocks.hostLocal.mockResolvedValue(undefined);
    // The login of the accept: the SSH client reports the key it saw once it is in.
    mocks.check.mockImplementation(async (_adapter: unknown, config: unknown) => {
        if (!mocks.presents) return { success: false, message: "Permission denied" };
        await hostKeyOf(config)?.onFirstKey?.(mocks.presents);
        return { success: true, message: "ok" };
    });
    row = {
        id: "conn-1", name: "Offsite", type: "storage", adapterId: "sftp", tenantId: "tenant-a",
        primaryCredentialId: null, sshCredentialId: null,
        config: JSON.stringify({ host: "sftp.example.test", port: 22, username: "backup" }),
        metadata: JSON.stringify(withPin({ airGapped: false, sshHostKeyChanged: newKey.fingerprint }, pinOf(oldKey))),
    };
    prismaMock.adapterConfig.findUnique.mockImplementation((async () => (row ? { ...row } : null)) as never);
    prismaMock.adapterConfig.updateMany.mockImplementation((async (args: { where: { metadata: string | null }; data: { metadata: string } }) => {
        if (!row || row.metadata !== args.where.metadata) return { count: 0 };
        row.metadata = args.data.metadata;
        return { count: 1 };
    }) as never);
});

describe("trusting the new host key of a server", () => {
    it("stores the key the server presents when it is the one the person was shown", async () => {
        const change = await acceptHostKey("conn-1", newKey.fingerprint, lena);

        expect(change).toMatchObject({ name: "Offsite", previous: oldKey.fingerprint, fingerprint: newKey.fingerprint });
        const metadata = parseMetadata(row!.metadata);
        expect(storedPin(metadata)).toMatchObject({ key: newKey.key, pinnedBy: "accepted" });
        expect(metadata.airGapped).toBe(false);
        expect(metadata.sshHostKeyChanged).toBeUndefined();
        expect(auditService.log).toHaveBeenCalledWith("u-lena", "UPDATE", "ADAPTER", expect.objectContaining({ action: HOST_KEY_AUDIT.accept, name: "Offsite", previous: oldKey.fingerprint, fingerprint: newKey.fingerprint }), "conn-1", { tenantId: "tenant-a" });
    });

    it("logs in without the old pin, which would refuse the very key it is to read", async () => {
        await acceptHostKey("conn-1", newKey.fingerprint, lena);
        const policy = hostKeyOf(mocks.check.mock.calls[0][1]);
        expect(policy).toMatchObject(endpoint);
        expect(policy?.pinned).toBeUndefined();
    });

    it("stores nothing when the server presents another key than the one shown", async () => {
        mocks.presents = thirdKey;
        const before = row!.metadata;

        await expect(acceptHostKey("conn-1", newKey.fingerprint, lena)).rejects.toBeInstanceOf(ValidationError);

        expect(row!.metadata).toBe(before);
        expect(auditService.log).not.toHaveBeenCalled();
    });

    it("stores nothing when the login fails, so a server that merely answers the port is not trusted", async () => {
        mocks.presents = null;
        const before = row!.metadata;

        await expect(acceptHostKey("conn-1", newKey.fingerprint, lena)).rejects.toThrow("could not log in");

        expect(row!.metadata).toBe(before);
    });

    it("leaves a connection that reaches the server DBackup runs on to a platform admin, before any login", async () => {
        mocks.hostLocal.mockRejectedValue(new ValidationError("It uses the SSH agent of the server DBackup runs on."));

        await expect(acceptHostKey("conn-1", newKey.fingerprint, lena)).rejects.toBeInstanceOf(ValidationError);
        await expect(forgetHostKey("conn-1", lena)).rejects.toBeInstanceOf(ValidationError);

        expect(mocks.check).not.toHaveBeenCalled();
        expect(prismaMock.adapterConfig.updateMany).not.toHaveBeenCalled();
    });

    it("answers a missing connection as not found", async () => {
        row = null;
        await expect(acceptHostKey("gone", newKey.fingerprint, lena)).rejects.toBeInstanceOf(NotFoundError);
        await expect(forgetHostKey("gone", lena)).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe("forgetting the pinned host key", () => {
    it("drops the pin and the note of a changed key, and keeps the rest of the metadata", async () => {
        const change = await forgetHostKey("conn-1", { userId: "u-lena", apiKeyId: "key-1" });

        expect(change).toMatchObject({ previous: oldKey.fingerprint, fingerprint: null });
        expect(parseMetadata(row!.metadata)).toEqual({ airGapped: false });
        expect(auditService.log).toHaveBeenCalledWith("u-lena", "UPDATE", "ADAPTER", expect.objectContaining({ action: HOST_KEY_AUDIT.forget, previous: oldKey.fingerprint }), "conn-1", { apiKeyId: "key-1", tenantId: "tenant-a" });
        expect(mocks.check).not.toHaveBeenCalled();
    });

    it("writes nothing for a connection without a pin", async () => {
        row!.metadata = JSON.stringify({ airGapped: false });

        const change = await forgetHostKey("conn-1", lena);

        expect(change.previous).toBeNull();
        expect(prismaMock.adapterConfig.updateMany).not.toHaveBeenCalled();
        expect(auditService.log).not.toHaveBeenCalled();
    });
});
