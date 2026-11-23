import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/logging/logger", () => {
    const child = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { logger: { ...child, child: () => child } };
});
vi.mock("@/lib/crypto", () => ({ decryptConfig: (config: unknown) => config }));
vi.mock("@/lib/tenant/context", () => ({ runAsTenant: (_tenant: string, run: () => unknown) => run() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn().mockResolvedValue(undefined) } }));

import { HostKeyMismatchError } from "@/lib/logging/errors";
import { parseMetadata, storedPin } from "@/lib/adapters/ssh-host-key-pins";
import { hostKeyFingerprint, type SeenHostKey } from "@/lib/transport/host-key";
import { auditService } from "@/services/audit-service";
import { formHostKeyProbe, HOST_KEY_AUDIT, noteMismatch, pinFirstKey, storedHostKeyPolicy } from "@/services/adapters/ssh-host-key-service";

const keyOf = (text: string): SeenHostKey => {
    const key = Buffer.from(text).toString("base64");
    return { type: "ssh-ed25519", key, fingerprint: hostKeyFingerprint(Buffer.from(key, "base64")) };
};
const first = keyOf("the key of the real server");
const second = keyOf("the key of another server");
const endpoint = { host: "sftp.example.test", port: 22 };
const connection = { id: "conn-1", tenantId: "tenant-a" };

/** One saved connection whose metadata the mocked client reads and writes like the database would. */
let row: { name: string; adapterId: string; tenantId: string; config: string; metadata: string | null } | null;

function auditActions(): string[] {
    return vi.mocked(auditService.log).mock.calls.map((call) => (call[3] as { action: string }).action);
}

beforeEach(() => {
    vi.clearAllMocks();
    row = { name: "Offsite", adapterId: "sftp", tenantId: "tenant-a", config: JSON.stringify({ host: "sftp.example.test", port: 22 }), metadata: JSON.stringify({ engineVersion: "9.6" }) };
    prismaMock.adapterConfig.findUnique.mockImplementation((async () => (row ? { ...row } : null)) as never);
    // The compare-and-set: the write only lands while the metadata is still what was read.
    prismaMock.adapterConfig.updateMany.mockImplementation((async (args: { where: { metadata: string | null }; data: { metadata: string } }) => {
        if (!row || row.metadata !== args.where.metadata) return { count: 0 };
        row.metadata = args.data.metadata;
        return { count: 1 };
    }) as never);
});

describe("pinning the host key of a first successful login", () => {
    it("keeps the whole key with its server beside what the metadata already held", async () => {
        await pinFirstKey(connection, endpoint, first);

        const metadata = parseMetadata(row!.metadata);
        expect(metadata.engineVersion).toBe("9.6");
        expect(storedPin(metadata)).toMatchObject({ ...endpoint, type: "ssh-ed25519", key: first.key, fingerprint: first.fingerprint, pinnedBy: "first-connect" });
        expect(auditActions()).toEqual([HOST_KEY_AUDIT.pin]);
        expect(vi.mocked(auditService.log).mock.calls[0][5]).toEqual({ tenantId: "tenant-a" });
    });

    it("changes nothing when the same key is seen again", async () => {
        await pinFirstKey(connection, endpoint, first);
        const stored = row!.metadata;
        await pinFirstKey(connection, endpoint, first);

        expect(row!.metadata).toBe(stored);
        expect(auditActions()).toEqual([HOST_KEY_AUDIT.pin]);
    });

    it("lets only one of two first logins that saw different keys pin, the other fails as a mismatch", async () => {
        const results = await Promise.allSettled([pinFirstKey(connection, endpoint, first), pinFirstKey(connection, endpoint, second)]);

        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        expect(failed).toHaveLength(1);
        expect(failed[0].reason).toBeInstanceOf(HostKeyMismatchError);
        const kept = storedPin(parseMetadata(row!.metadata))!;
        expect([first.key, second.key]).toContain(kept.key);
        expect((failed[0].reason as HostKeyMismatchError).expected).toBe(kept.fingerprint);
    });

    it("reads the metadata again when another writer changed it between the read and the write", async () => {
        let interfered = false;
        prismaMock.adapterConfig.findUnique.mockImplementation((async () => {
            const read = { ...row! };
            // The health check stores its own note right after this read.
            if (!interfered) {
                interfered = true;
                row!.metadata = JSON.stringify({ engineVersion: "9.7" });
            }
            return read;
        }) as never);

        await pinFirstKey(connection, endpoint, first);

        const metadata = parseMetadata(row!.metadata);
        expect(metadata.engineVersion).toBe("9.7");
        expect(storedPin(metadata)?.key).toBe(first.key);
    });
});

describe("the policy the SSH clients of a saved connection get", () => {
    const saved = { id: "conn-1", adapterId: "sftp", tenantId: "tenant-a" };

    it("pins on the first connect of a connection saved before pins existed", async () => {
        const policy = await storedHostKeyPolicy(saved, { host: "sftp.example.test", port: 22 });

        expect(policy?.pinned).toBeUndefined();
        await policy!.onFirstKey!(first);
        expect(storedPin(parseMetadata(row!.metadata))?.fingerprint).toBe(first.fingerprint);
    });

    it("hands the clients the pinned key afterwards", async () => {
        await pinFirstKey(connection, endpoint, first);
        const policy = await storedHostKeyPolicy(saved, { host: "SFTP.example.test", port: "22" });
        expect(policy?.pinned).toEqual({ type: "ssh-ed25519", key: first.key });
    });

    it("counts a pin only while the connection still dials the host and port it was taken at", async () => {
        await pinFirstKey(connection, endpoint, first);
        expect((await storedHostKeyPolicy(saved, { host: "new-server.example.test", port: 22 }))?.pinned).toBeUndefined();
        expect((await storedHostKeyPolicy(saved, { host: "sftp.example.test", port: 2222 }))?.pinned).toBeUndefined();
    });

    it("checks nothing for a connection with the check switched off, and checks one that leaves the switch out", async () => {
        expect(await storedHostKeyPolicy(saved, { host: "sftp.example.test", port: 22, verifyHostKey: false })).toBeNull();
        expect(await storedHostKeyPolicy(saved, { host: "sftp.example.test", port: 22 })).not.toBeNull();
        expect(await storedHostKeyPolicy(saved, { host: "sftp.example.test", port: 22, verifyHostKey: true })).not.toBeNull();
    });

    it("covers a database in SSH mode by its SSH server and leaves a direct connection alone", async () => {
        const mysql = { id: "conn-1", adapterId: "mysql", tenantId: "tenant-a" };
        const policy = await storedHostKeyPolicy(mysql, { connectionMode: "ssh", host: "127.0.0.1", port: 3306, sshHost: "db1.example.test", sshPort: 2222 });
        expect(policy).toMatchObject({ host: "db1.example.test", port: 2222 });
        expect(await storedHostKeyPolicy(mysql, { connectionMode: "direct", host: "db1.example.test", port: 3306 })).toBeNull();
        expect(await storedHostKeyPolicy(mysql, { host: "db1.example.test", port: 3306 })).toBeNull();
    });

    it("writes one audit entry per changed key, not one per health check", async () => {
        await pinFirstKey(connection, endpoint, first);
        const mismatch = { ...endpoint, expected: first.fingerprint, presented: second.fingerprint };

        await noteMismatch(connection, mismatch);
        await noteMismatch(connection, mismatch);
        await noteMismatch(connection, mismatch);

        expect(auditActions().filter((action) => action === HOST_KEY_AUDIT.mismatch)).toHaveLength(1);
        // The pin itself stays, the changed key is only noted.
        expect(storedPin(parseMetadata(row!.metadata))?.fingerprint).toBe(first.fingerprint);
    });
});

describe("the test of a connection form", () => {
    it("reports the key of a new connection without storing anything", async () => {
        const probe = await formHostKeyProbe("sftp", { host: "sftp.example.test", port: 22 });

        await probe.policy!.onFirstKey!(first);
        await probe.pinSeen();

        expect(probe.seen()).toEqual(first);
        expect(prismaMock.adapterConfig.updateMany).not.toHaveBeenCalled();
    });

    it("checks against the pin of the saved connection the form edits", async () => {
        await pinFirstKey(connection, endpoint, first);
        const probe = await formHostKeyProbe("sftp", { host: "sftp.example.test", port: 22 }, "conn-1");
        expect(probe.policy?.pinned).toEqual({ type: "ssh-ed25519", key: first.key });
    });

    it("pins the key of a saved connection without a pin on its first passing test", async () => {
        const probe = await formHostKeyProbe("sftp", { host: "sftp.example.test", port: 22 }, "conn-1");
        await probe.policy!.onFirstKey!(first);
        await probe.pinSeen();
        expect(storedPin(parseMetadata(row!.metadata))?.fingerprint).toBe(first.fingerprint);
    });

    it("leaves the saved pin alone when the form was edited to another server", async () => {
        await pinFirstKey(connection, endpoint, first);
        const probe = await formHostKeyProbe("sftp", { host: "other.example.test", port: 22 }, "conn-1");

        expect(probe.policy?.pinned).toBeUndefined();
        await probe.policy!.onFirstKey!(second);
        await probe.pinSeen();

        expect(storedPin(parseMetadata(row!.metadata))?.fingerprint).toBe(first.fingerprint);
    });

    it("checks nothing with the switch of the form off", async () => {
        const probe = await formHostKeyProbe("sftp", { host: "sftp.example.test", port: 22, verifyHostKey: false }, "conn-1");
        expect(probe.policy).toBeNull();
    });
});
