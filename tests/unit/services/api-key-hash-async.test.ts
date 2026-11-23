// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every request with a Bearer value hashes it before anything else, so the hash runs on the thread
 * pool of Node and never through `scryptSync`, which would hold up every other request meanwhile.
 * The hash stays the one existing keys were stored with, the legacy SHA-256 path included.
 */
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), scryptSync: vi.fn() }));

vi.mock("crypto", async (importOriginal) => {
    const actual = await importOriginal<typeof import("crypto")>();
    return { ...actual, default: actual, scryptSync: (...args: unknown[]) => mocks.scryptSync(...args) };
});
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ default: { apiKey: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/services/tenant/tenant-allowances", () => ({ assertMayAddKind: vi.fn() }));

const actual = await vi.importActual<typeof import("crypto")>("crypto");
const { apiKeyService } = await import("@/services/auth/api-key-service");

const RAW = "dbackup_" + "ab".repeat(30);
const STORED = actual.scryptSync(RAW, "dbackup-api-key-scrypt-v1", 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");

describe("the hash of an API key", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue(null);
    });

    it("never blocks the event loop with scryptSync, and finds a key by the hash it was stored with", async () => {
        let ticks = 0;
        const timer = setInterval(() => ticks++, 1);
        try {
            await apiKeyService.validate(RAW);
        } finally {
            clearInterval(timer);
        }
        expect(mocks.scryptSync).not.toHaveBeenCalled();
        expect(mocks.findUnique.mock.calls[0][0].where.hashedKey).toBe(STORED);
        // The event loop went on while the hash was made.
        expect(ticks).toBeGreaterThan(0);
    });

    it("still finds a key stored with the legacy SHA-256 hash and stores its scrypt hash", async () => {
        const legacy = actual.createHash("sha256").update(RAW).digest("hex");
        mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        await apiKeyService.validate(RAW);
        expect(mocks.findUnique.mock.calls[1][0].where.hashedKey).toBe(legacy);
        expect(mocks.update).not.toHaveBeenCalled();

        mocks.findUnique.mockReset();
        mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "key-old", enabled: false });
        await expect(apiKeyService.validate(RAW)).rejects.toThrow();
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: "key-old" }, data: { hashedKey: STORED } });
    });
});
