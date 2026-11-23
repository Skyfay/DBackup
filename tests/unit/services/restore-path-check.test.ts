import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";

/**
 * The check whether a folder of a restore target holds files finds the target the way the restore
 * does, so a shared destination that takes only encrypted backups, which a restore never writes
 * into, is not offered, and a folder that leaves the connection is refused before anything is dialed.
 */

const mocks = vi.hoisted(() => ({
    findDestination: vi.fn(),
    destinationAccess: vi.fn(),
    list: vi.fn(),
}));

vi.mock("@/services/sharing/destination-access", () => ({
    ANY_STORAGE_ROLE: ["DESTINATION", "SOURCE"],
    findDestination: (...args: unknown[]) => mocks.findDestination(...args),
    destinationAccess: (...args: unknown[]) => mocks.destinationAccess(...args),
    openRow: async () => ({ adapter: { list: (...args: unknown[]) => mocks.list(...args) }, config: { host: "nas.internal" } }),
}));

const { checkRestorePath } = await import("@/services/storage/restore-path-check");

const SHARED = { row: { id: "nas", tenantId: "provider" }, mode: { kind: "customer", tenantId: "acme" }, tenantId: "acme" };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([{ name: "a.txt" }]);
});

describe("checking a folder of a restore target for files", () => {
    it("lists a destination shared with the tenant that takes restored files", async () => {
        mocks.findDestination.mockResolvedValue(SHARED);
        mocks.destinationAccess.mockResolvedValue({ mode: SHARED.mode, provided: { encryptedOnly: false } });

        await expect(checkRestorePath("nas", "restore")).resolves.toEqual({ status: "occupied", itemCount: 1 });
        expect(mocks.findDestination).toHaveBeenCalledWith("nas", undefined, { roles: ["DESTINATION", "SOURCE"] });
    });

    it("does not offer a shared destination that takes only encrypted backups, where a restore never writes", async () => {
        mocks.findDestination.mockResolvedValue(SHARED);
        mocks.destinationAccess.mockResolvedValue({ mode: SHARED.mode, provided: { encryptedOnly: true } });

        await expect(checkRestorePath("nas", "restore")).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it.each(["../other", "data\\..\\..\\other", "%2e%2e/other", "data/.. /other"])("refuses the folder %s, which leaves the connection, before it looks anything up", async (folder) => {
        await expect(checkRestorePath("nas", folder)).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.findDestination).not.toHaveBeenCalled();
        expect(mocks.list).not.toHaveBeenCalled();
    });
});
