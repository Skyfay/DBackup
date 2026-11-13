// @vitest-environment node
/**
 * The way a host key gets from the test of a connection form into the pin of the saved connection:
 * the test answers the key it saw, the form sends it with the save, and the save stores it as the
 * pin. Nothing else of a request sets a pin, an edit to another server drops it, and a copy starts
 * without one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.stubEnv("ENCRYPTION_KEY", "b".repeat(64));

const mocks = vi.hoisted(() => ({ runAdapterTest: vi.fn() }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: async () => ({ username: "backup", password: "login-pw" }) }));
vi.mock("@/lib/transport/adapter-invoke", () => ({ runAdapterTest: mocks.runAdapterTest }));
vi.mock("@/lib/adapters/snapshot-validation", () => ({ validateSnapshotConfig: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("headers was called outside a request scope"); } }));

const { encryptConfig } = await import("@/lib/crypto");
const { createAdapter } = await import("@/services/adapters/adapter-create");
const { updateAdapter } = await import("@/services/adapters/adapter-update");
const { cloneAdapter } = await import("@/services/adapters/adapter-clone");
const { testConnection } = await import("@/services/adapters/connection-test");
const { parseMetadata, storedPin, withPin } = await import("@/lib/adapters/ssh-host-key-pins");
const { hostKeyFingerprint, hostKeyMismatch, hostKeyOf } = await import("@/lib/transport/host-key");
const { runAsTenant } = await import("@/lib/tenant/context");

const TENANT = { id: "msp", name: "MSP", blocksLocalNetwork: false, allowedNetworks: "[]", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true, addsApiKeys: true };
const keyOf = (text: string) => {
    const key = Buffer.from(text).toString("base64");
    return { type: "ssh-ed25519", key, fingerprint: hostKeyFingerprint(Buffer.from(key, "base64")) };
};
const serverKey = keyOf("the key of the server");
const otherKey = keyOf("the key of another server");
const SFTP = { host: "203.0.113.20", port: 22, username: "backup", password: "saved-pw", authType: "password", pathPrefix: "/backups" };
const pinned = (key = serverKey) => ({ host: "203.0.113.20", port: 22, ...key, pinnedAt: "2026-11-01T10:00:00.000Z", pinnedBy: "first-connect" as const });

const storedRow = (metadata: Record<string, unknown> | null, config: Record<string, unknown> = SFTP) => ({
    id: "sftp-1", type: "storage", adapterId: "sftp", lastError: null, config: JSON.stringify(encryptConfig(config)), tenantId: "msp",
    storageRole: "DESTINATION", name: "Offsite", primaryCredentialId: null, sshCredentialId: null, metadata: metadata ? JSON.stringify(metadata) : null,
});

const savedMetadata = () => parseMetadata((prismaMock.adapterConfig.update.mock.calls[0][0].data as { metadata?: string }).metadata ?? null);

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.tenant.findUnique.mockResolvedValue(TENANT as never);
    prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
    prismaMock.adapterConfig.findMany.mockResolvedValue([]);
    prismaMock.credentialProfile.findMany.mockResolvedValue([]);
    prismaMock.connectionShare.findMany.mockResolvedValue([]);
    prismaMock.connectionShare.findUnique.mockResolvedValue(null);
    prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "new", ...args.data })) as never);
    prismaMock.adapterConfig.update.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ ...storedRow(null), ...args.data })) as never);
    prismaMock.adapterConfig.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("the test of a connection form", () => {
    it("answers the host key of a new connection once the login succeeded", async () => {
        // The SSH client of the adapter reports the key it saw to the policy the test put on the config.
        mocks.runAdapterTest.mockImplementation(async (_adapter: unknown, config: unknown) => {
            await hostKeyOf(config)?.onFirstKey?.(serverKey);
            return { success: true, message: "Connected" };
        });

        const outcome = await runAsTenant("msp", () => testConnection({ adapterId: "sftp", config: SFTP }));

        expect(outcome).toMatchObject({ ok: true, result: { success: true, hostKey: serverKey } });
        expect(prismaMock.adapterConfig.updateMany).not.toHaveBeenCalled();
    });

    it("answers no key for a login that failed or with the check switched off", async () => {
        mocks.runAdapterTest.mockImplementation(async (_adapter: unknown, config: unknown) => ({ success: false, message: `refused ${hostKeyOf(config) ? "checked" : "unchecked"}` }));

        const failed = await runAsTenant("msp", () => testConnection({ adapterId: "sftp", config: SFTP }));
        const unchecked = await runAsTenant("msp", () => testConnection({ adapterId: "sftp", config: { ...SFTP, verifyHostKey: false } }));

        expect(failed).toMatchObject({ result: { success: false, message: "refused checked" } });
        expect((failed as { result: { hostKey?: unknown } }).result.hostKey).toBeUndefined();
        expect(unchecked).toMatchObject({ result: { message: "refused unchecked" } });
    });

    it("fails with both fingerprints when the server of a saved connection presents another key", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(storedRow(withPin({}, pinned())) as never);
        mocks.runAdapterTest.mockImplementation(async (_adapter: unknown, config: unknown) => {
            const policy = hostKeyOf(config)!;
            expect(policy.pinned).toEqual({ type: serverKey.type, key: serverKey.key });
            // What the SSH client does with another key: it ends the connection and tells the policy.
            const error = hostKeyMismatch(policy, otherKey.fingerprint);
            await new Promise((resolve) => setTimeout(resolve, 0));
            return { success: false, message: `SFTP connection failed: ${error.message}` };
        });

        const outcome = await runAsTenant("msp", () => testConnection({ adapterId: "sftp", config: { ...SFTP, password: "" }, configId: "sftp-1", storedConfigId: "sftp-1" }));

        const result = (outcome as { result: { success: boolean; message: string; hostKeyMismatch?: unknown } }).result;
        expect(result.success).toBe(false);
        expect(result.hostKeyMismatch).toEqual({ expected: serverKey.fingerprint, presented: otherKey.fingerprint });
        expect(result.message).toContain(serverKey.fingerprint);
        expect(result.message).toContain(otherKey.fingerprint);
        expect(result.message.startsWith("The server at 203.0.113.20:22")).toBe(true);
    });
});

describe("saving a connection with the key its test saw", () => {
    const create = (extra: Record<string, unknown> = {}, config: Record<string, unknown> = SFTP) =>
        runAsTenant("msp", () => createAdapter({ name: "Offsite", type: "storage", adapterId: "sftp", config, ...extra }));
    const createdMetadata = () => parseMetadata((prismaMock.adapterConfig.create.mock.calls[0][0].data as { metadata?: string }).metadata ?? null);

    it("pins the tested key of a new connection with the server it was seen at", async () => {
        await create({ sshHostKey: { type: serverKey.type, key: serverKey.key }, metadata: { airGapped: true } });

        expect(storedPin(createdMetadata())).toMatchObject({ host: "203.0.113.20", port: 22, key: serverKey.key, fingerprint: serverKey.fingerprint, pinnedBy: "form-test" });
        expect(createdMetadata().airGapped).toBe(true);
    });

    it("stores no pin for a create without a tested key, like one of the API, which pins on its first connect", async () => {
        await create();
        expect(prismaMock.adapterConfig.create.mock.calls[0][0].data.metadata).toBeUndefined();
    });

    it("never takes a pin from the metadata of a request", async () => {
        await create({ metadata: withPin({ airGapped: true }, pinned(otherKey)) });
        expect(createdMetadata()).toEqual({ airGapped: true });
    });

    it("stores no pin with the check switched off or for a key that reads as none", async () => {
        await create({ sshHostKey: { type: serverKey.type, key: serverKey.key } }, { ...SFTP, verifyHostKey: false });
        await create({ sshHostKey: { type: "ssh-ed25519\nevil", key: serverKey.key } });
        expect(prismaMock.adapterConfig.create.mock.calls[0][0].data.metadata).toBeUndefined();
        expect(prismaMock.adapterConfig.create.mock.calls[1][0].data.metadata).toBeUndefined();
    });
});

describe("editing a connection that holds a pin", () => {
    const edit = (input: Record<string, unknown>) => runAsTenant("msp", () => updateAdapter("sftp-1", input));

    beforeEach(() => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(storedRow(withPin({ airGapped: false }, pinned())) as never);
    });

    it("keeps the pin when the form sends back metadata without it or with another one", async () => {
        await edit({ name: "Offsite 2", metadata: { airGapped: true } });
        expect(storedPin(savedMetadata())?.key).toBe(serverKey.key);
        expect(savedMetadata().airGapped).toBe(true);

        prismaMock.adapterConfig.update.mockClear();
        await edit({ metadata: withPin({ airGapped: true }, pinned(otherKey)) });
        expect(storedPin(savedMetadata())?.key).toBe(serverKey.key);
    });

    it("keeps the pin through an edit that leaves the server as it is, and ignores a key the form sends", async () => {
        await edit({ config: { ...SFTP, pathPrefix: "/other" }, sshHostKey: { type: otherKey.type, key: otherKey.key } });
        expect((prismaMock.adapterConfig.update.mock.calls[0][0].data as { metadata?: string }).metadata).toBeUndefined();
    });

    it("drops the pin when the connection moves to another host or port", async () => {
        await edit({ config: { ...SFTP, host: "203.0.113.99" } });
        expect(storedPin(savedMetadata())).toBeNull();
        expect(savedMetadata().airGapped).toBe(false);

        prismaMock.adapterConfig.update.mockClear();
        await edit({ config: { ...SFTP, port: 2222 } });
        expect(storedPin(savedMetadata())).toBeNull();
    });

    it("pins the key the form tested at the new server", async () => {
        await edit({ config: { ...SFTP, host: "203.0.113.99" }, sshHostKey: { type: otherKey.type, key: otherKey.key } });
        expect(storedPin(savedMetadata())).toMatchObject({ host: "203.0.113.99", port: 22, key: otherKey.key, pinnedBy: "form-test" });
    });
});

describe("a copy of a connection", () => {
    it("starts without the pin of the original and keeps its other settings", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(storedRow(withPin({ airGapped: true, sshHostKeyChanged: otherKey.fingerprint }, pinned())) as never);

        await runAsTenant("msp", () => cloneAdapter("sftp-1", {}));

        const data = prismaMock.adapterConfig.create.mock.calls[0][0].data as { metadata?: string };
        expect(parseMetadata(data.metadata ?? null)).toEqual({ airGapped: true });
    });
});
