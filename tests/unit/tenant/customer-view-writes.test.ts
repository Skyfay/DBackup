/**
 * A view of a customer on a destination another tenant shares lives as long as the work that opened
 * it, like a restore of many files. Once the share stops, the folder of the customer is emptied and
 * the provider sees the destination plainly again, so a write through the old view must fail rather
 * than land where the provider reads it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    provided: vi.fn(),
    upload: vi.fn(),
    sessionUpload: vi.fn(),
}));

vi.mock("@/services/sharing/provided", () => ({ providedConnection: (...args: unknown[]) => mocks.provided(...args) }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({
    registry: {
        get: (id: string) => ({
            id,
            type: "storage",
            upload: mocks.upload,
            download: vi.fn(),
            list: vi.fn(),
            delete: vi.fn(),
            openSession: async () => ({ upload: mocks.sessionUpload, close: vi.fn() }),
        }),
    },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async () => ({ host: "nas.example.test" }) }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

const { openRow, SHARE_ENDED } = await import("@/services/sharing/destination-access");

const row = { id: "nas", tenantId: "provider", type: "storage", adapterId: "sftp", name: "NAS" } as never;
const customer = { kind: "customer", tenantId: "acme" } as const;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue(true);
    mocks.sessionUpload.mockResolvedValue(true);
});

describe("writes through the view of a customer", () => {
    it("go through while the destination is shared with it", async () => {
        mocks.provided.mockResolvedValue({ id: "nas" });
        const { adapter, config } = await openRow(row, customer);

        await expect(adapter.upload(config, "/tmp/a", "restored/a.txt")).resolves.toBe(true);
        expect(mocks.provided).toHaveBeenCalledWith("nas", "acme");
    });

    it("fail once the share stopped while the view was open, for single uploads and sessions", async () => {
        mocks.provided.mockResolvedValue({ id: "nas" });
        const { adapter, config } = await openRow(row, customer);
        const session = await adapter.openSession!(config);

        mocks.provided.mockResolvedValue(null);

        await expect(adapter.upload(config, "/tmp/a", "restored/a.txt")).rejects.toThrow(SHARE_ENDED);
        await expect(session.upload("/tmp/b", "restored/b.txt")).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.sessionUpload).not.toHaveBeenCalled();
    });

    it("leave the own view of a destination as it is", async () => {
        const { adapter, config } = await openRow(row, { kind: "own" });

        await expect(adapter.upload(config, "/tmp/a", "a.txt")).resolves.toBe(true);
        expect(mocks.provided).not.toHaveBeenCalled();
    });
});
