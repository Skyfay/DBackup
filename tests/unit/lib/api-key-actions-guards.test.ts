import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

type Group = { name: string; permissions: string } | null;

const mocks = vi.hoisted(() => ({
    denied: new Set<string>(),
    viewer: null as { id: string; name: string; group: { name: string; permissions: string } | null } | null,
    keys: { create: vi.fn(), update: vi.fn(), rotate: vi.fn(), ownerOf: vi.fn(), nameTaken: vi.fn() },
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (mocks.denied.has(permission)) throw new PermissionError(permission);
    }),
    getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/auth/api-key-service", () => ({ apiKeyService: mocks.keys }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));

const { createApiKey, rotateApiKey, updateApiKey } = await import("@/app/actions/auth/api-key");

const group = (name: string, permissions: string[]): Group => ({ name, permissions: JSON.stringify(permissions) });
const OPERATORS = group("Operators", ["jobs:read", "jobs:execute", "history:read"]);
const IN_90_DAYS = "2026-12-28T10:00:00.000Z";

describe("what an API key may get", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.denied = new Set();
        mocks.viewer = { id: "lena", name: "Lena Graf", group: OPERATORS };
        mocks.keys.nameTaken.mockResolvedValue(false);
        mocks.keys.create.mockResolvedValue({ apiKey: { id: "key-new" }, rawKey: "dbackup_secret" });
        mocks.keys.update.mockResolvedValue({ before: { name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: null }, after: {} });
        mocks.keys.rotate.mockResolvedValue({ apiKey: { id: "key-1", name: "CI pipeline" }, rawKey: "dbackup_new" });
    });

    it("makes a key with what the group of its owner allows and keeps its task in the audit log", async () => {
        const result = await createApiKey({ name: "CI pipeline", permissions: ["jobs:execute", "history:read"], expiresAt: IN_90_DAYS, template: "ci" });

        expect(result).toEqual({ success: true, data: { apiKey: { id: "key-new" }, rawKey: "dbackup_secret" } });
        expect(mocks.keys.create).toHaveBeenCalledWith({ name: "CI pipeline", permissions: ["jobs:execute", "history:read"], userId: "lena", expiresAt: new Date(IN_90_DAYS) });
        expect(mocks.audit).toHaveBeenCalledWith(
            "lena",
            "CREATE",
            "API_KEY",
            { apiKeyId: "key-new", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], expiresAt: IN_90_DAYS, template: "ci" },
            "key-new"
        );
    });

    it("refuses a key with more than the group of its owner may do", async () => {
        const result = await createApiKey({ name: "Admin", permissions: ["jobs:execute", "users:write"], expiresAt: null });

        expect(result).toEqual({ success: false, error: "Your group may not change users, so no key of yours may." });
        expect(mocks.keys.create).not.toHaveBeenCalled();
    });

    it("refuses a key without a permission and a name another key has", async () => {
        expect(await createApiKey({ name: "Empty", permissions: [], expiresAt: null })).toEqual({ success: false, error: "Give the key at least one permission." });

        mocks.keys.nameTaken.mockResolvedValue(true);
        expect(await createApiKey({ name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: null })).toEqual({ success: false, error: "A key by this name exists already." });
        expect(mocks.keys.create).not.toHaveBeenCalled();
    });

    it("gives a key of someone else nothing beyond the group of its owner", async () => {
        mocks.viewer = { id: "manu", name: "Manu", group: group("SuperAdmin", []) };
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute"], group: OPERATORS });

        const result = await updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:execute", "storage:delete"], expiresAt: null });

        expect(result).toEqual({ success: false, error: "The group of its owner may not delete backups, so the key may not either." });
        expect(mocks.keys.update).not.toHaveBeenCalled();
    });

    it("never lets someone hand a key more than they may do themselves", async () => {
        mocks.viewer = { id: "tom", name: "Tom Weber", group: group("Viewers", ["jobs:read"]) };
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:read"], group: OPERATORS });

        const result = await updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:read", "jobs:execute"], expiresAt: null });

        expect(result).toEqual({ success: false, error: "Your group may not run jobs, so you cannot give it to a key." });
    });

    it("keeps what a key holds already, even what its owner lost, when only its name changes", async () => {
        mocks.viewer = { id: "tom", name: "Tom Weber", group: group("Viewers", ["jobs:read"]) };
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "storage:delete"], group: OPERATORS });

        const result = await updateApiKey("key-1", { name: "Deploy", permissions: ["jobs:execute", "storage:delete"], expiresAt: null });

        expect(result).toEqual({ success: true });
        expect(mocks.keys.update).toHaveBeenCalledWith("key-1", { name: "Deploy", permissions: ["jobs:execute", "storage:delete"], expiresAt: null });
        expect(mocks.audit).toHaveBeenCalledWith(
            "tom",
            "UPDATE",
            "API_KEY",
            expect.objectContaining({ name: "Deploy", renamedFrom: "CI pipeline" }),
            "key-1"
        );
    });

    it("lets only the owner, or someone who may do all the key may do, rotate it", async () => {
        mocks.viewer = { id: "tom", name: "Tom Weber", group: group("Viewers", ["jobs:read"]) };
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], group: OPERATORS });

        expect(await rotateApiKey("key-1")).toEqual({ success: false, error: "The key may run jobs and see the history, which your group may not, so only its owner rotates it." });
        expect(mocks.keys.rotate).not.toHaveBeenCalled();

        mocks.viewer = { id: "lena", name: "Lena Graf", group: OPERATORS };
        expect(await rotateApiKey("key-1")).toEqual({ success: true, data: { apiKey: { id: "key-1", name: "CI pipeline" }, rawKey: "dbackup_new" } });
    });

    it("counts only what a key may use when someone else rotates it", async () => {
        mocks.viewer = { id: "tom", name: "Tom Weber", group: group("Viewers", ["jobs:execute"]) };
        // The key holds history:read too, but its owner lost it, so it may not use it.
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], group: group("Operators", ["jobs:execute"]) });

        expect(await rotateApiKey("key-1")).toMatchObject({ success: true });
    });

    it("needs the right to change API keys", async () => {
        mocks.denied = new Set(["api-keys:write"]);

        await expect(createApiKey({ name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: null })).rejects.toBeInstanceOf(PermissionError);
        await expect(updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: null })).rejects.toBeInstanceOf(PermissionError);
        await expect(rotateApiKey("key-1")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.keys.create).not.toHaveBeenCalled();
        expect(mocks.keys.update).not.toHaveBeenCalled();
        expect(mocks.keys.rotate).not.toHaveBeenCalled();
    });
});
