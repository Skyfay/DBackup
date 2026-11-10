/**
 * The extra headers of a Generic Webhook carry API keys and are encrypted now. Earlier versions
 * stored them as plain text, which the start encrypts, also a header `decrypt` would take for
 * ciphertext because it has three `:` parts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    adapterFind: vi.fn(),
    adapterUpdate: vi.fn(),
    deletedFind: vi.fn(),
    deletedUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: { findMany: mocks.adapterFind, update: mocks.adapterUpdate },
        deletedRecord: { findMany: mocks.deletedFind, update: mocks.deletedUpdate },
    },
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { decryptConfig, encrypt } from "@/lib/crypto";
import { sealConfig, sealPlainSecrets } from "@/lib/server/seal-plain-secrets";

const HEADERS = "X-A: b:c";

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", "b".repeat(64));
    mocks.adapterFind.mockResolvedValue([]);
    mocks.deletedFind.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("the plain extra headers of an earlier version", () => {
    it("fail to open before they are encrypted and open as written after", () => {
        const stored = { webhookUrl: encrypt("https://hooks.example.com/in"), customHeaders: HEADERS };
        expect(() => decryptConfig(stored)).toThrow();

        const sealed = JSON.parse(sealConfig(JSON.stringify(stored))!);
        expect(sealed.customHeaders).not.toBe(HEADERS);
        expect(decryptConfig(sealed).customHeaders).toBe(HEADERS);
    });

    it("are encrypted once, a second start leaves them alone", () => {
        const once = sealConfig(JSON.stringify({ customHeaders: HEADERS }))!;
        expect(sealConfig(once)).toBeNull();
        expect(sealConfig(JSON.stringify({ customHeaders: "" }))).toBeNull();
        expect(sealConfig("not json")).toBeNull();
    });

    it("are encrypted at the start in the connections and in Recently deleted", async () => {
        const config = JSON.stringify({ method: "POST", customHeaders: HEADERS });
        mocks.adapterFind.mockResolvedValue([{ id: "c1", config }]);
        mocks.deletedFind.mockResolvedValue([{ id: "d1", data: JSON.stringify({ record: { id: "c2", config }, versionHistory: [] }) }]);

        await sealPlainSecrets();

        const saved = JSON.parse(mocks.adapterUpdate.mock.calls[0][0].data.config);
        expect(mocks.adapterUpdate.mock.calls[0][0].where).toEqual({ id: "c1" });
        expect(saved.method).toBe("POST");
        expect(decryptConfig(saved).customHeaders).toBe(HEADERS);

        const snapshot = JSON.parse(mocks.deletedUpdate.mock.calls[0][0].data.data);
        expect(snapshot.versionHistory).toEqual([]);
        expect(decryptConfig(JSON.parse(snapshot.record.config)).customHeaders).toBe(HEADERS);
    });

    it("never stop the start when the database fails", async () => {
        mocks.adapterFind.mockRejectedValue(new Error("locked"));
        await expect(sealPlainSecrets()).resolves.toBeUndefined();
    });
});
