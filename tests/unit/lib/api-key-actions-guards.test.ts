import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";

type Viewer = { id: string; name: string; isPlatformAdmin: boolean; permissions: string[]; tenantId: string | null };

const mocks = vi.hoisted(() => ({
    denied: new Set<string>(),
    viewer: null as Viewer | null,
    keys: {
        create: vi.fn(), update: vi.fn(), rotate: vi.fn(), ownerOf: vi.fn(), nameTaken: vi.fn(), ceilingFor: vi.fn(),
        toggle: vi.fn(), delete: vi.fn(), getById: vi.fn(),
        // Like the service, every key in turn through the guard, a refusal as the failure of that key.
        deleteMany: vi.fn(), toggleMany: vi.fn(),
    },
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (mocks.denied.has(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
    getViewer: vi.fn(async () => mocks.viewer),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/auth/api-key-service", () => ({ apiKeyService: mocks.keys }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/shared-servers", () => ({ sharesWithCustomers: vi.fn(async () => false) }));

const { bulkDeleteApiKeys, bulkToggleApiKeys, createApiKey, deleteApiKey, rotateApiKey, toggleApiKey, updateApiKey } = await import("@/app/actions/auth/api-key");

/** What the service does with a guard: run it for every key, record a refusal as a failure. */
async function bulkWith(ids: string[], guard?: (id: string) => Promise<void>) {
    const result = { succeeded: [] as string[], failed: [] as { id: string; error: string }[] };
    for (const id of ids) {
        try {
            await guard?.(id);
            result.succeeded.push(id);
        } catch (error: unknown) {
            result.failed.push({ id, error: (error as Error).message });
        }
    }
    return result;
}

/** Someone who may do what their group in the tenant gives, as `getViewer` hands them on. */
const viewer = (id: string, name: string, permissions: string[], isPlatformAdmin = false): Viewer => ({ id, name, isPlatformAdmin, permissions, tenantId: "default" });
const OPERATORS = ["jobs:read", "jobs:execute", "history:read"];
const IN_90_DAYS = "2026-12-28T10:00:00.000Z";

describe("what an API key may get", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.denied = new Set();
        mocks.viewer = viewer("lena", "Lena Graf", OPERATORS);
        mocks.keys.nameTaken.mockResolvedValue(false);
        // A key of the viewer may do what their groups give in the tenant, never the platform's own.
        mocks.keys.ceilingFor.mockImplementation(async () => mocks.viewer?.permissions ?? []);
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
        // A platform admin may do anything, but the key never gets more than its owner may do in its tenant.
        mocks.viewer = viewer("manu", "Manu", AVAILABLE_PERMISSIONS.map((permission) => permission.id), true);
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute"], ownerPermissions: OPERATORS });

        const result = await updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:execute", "storage:delete"], expiresAt: null });

        expect(result).toEqual({ success: false, error: "The group of its owner may not delete backups, so the key may not either." });
        expect(mocks.keys.update).not.toHaveBeenCalled();
    });

    it("never lets someone hand a key more than they may do themselves", async () => {
        mocks.viewer = viewer("tom", "Tom Weber", ["jobs:read"]);
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:read"], ownerPermissions: OPERATORS });

        const result = await updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:read", "jobs:execute"], expiresAt: null });

        expect(result).toEqual({ success: false, error: "Your group may not run jobs, so you cannot give it to a key." });
    });

    it("keeps what a key holds already, even what its owner lost, when only its name changes", async () => {
        mocks.viewer = viewer("tom", "Tom Weber", ["jobs:read"]);
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "storage:delete"], ownerPermissions: OPERATORS });

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
        mocks.viewer = viewer("tom", "Tom Weber", ["jobs:read"]);
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], ownerPermissions: OPERATORS });

        expect(await rotateApiKey("key-1")).toEqual({ success: false, error: "The key may run jobs and see the history, which your group may not, so only its owner rotates it." });
        expect(mocks.keys.rotate).not.toHaveBeenCalled();

        mocks.viewer = viewer("lena", "Lena Graf", OPERATORS);
        expect(await rotateApiKey("key-1")).toEqual({ success: true, data: { apiKey: { id: "key-1", name: "CI pipeline" }, rawKey: "dbackup_new" } });
    });

    it("counts only what a key may use when someone else rotates it", async () => {
        mocks.viewer = viewer("tom", "Tom Weber", ["jobs:execute"]);
        // The key holds history:read too, but its owner lost it, so it may not use it.
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], ownerPermissions: ["jobs:execute"] });

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

    it("caps a new key by what a key of the viewer may do, which leaves out the rights of their platform group on the platform", async () => {
        mocks.viewer = viewer("lena", "Lena Graf", [...OPERATORS, "settings:write"]);
        mocks.keys.ceilingFor.mockResolvedValue(OPERATORS);
        const result = await createApiKey({ name: "Settings bot", permissions: ["settings:write"], expiresAt: IN_90_DAYS });
        expect(result.success).toBe(false);
        expect(mocks.keys.ceilingFor).toHaveBeenCalledWith("lena", "default");
        expect(mocks.keys.create).not.toHaveBeenCalled();
    });

    describe("pausing, resuming and deleting a key of someone else", () => {
        /** Lena's key runs jobs and reads the history, Tom's own key only reads jobs. */
        const KEYS: Record<string, { ownerId: string; name: string; permissions: string[]; ownerPermissions: string[] }> = {
            "key-lena": { ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], ownerPermissions: OPERATORS },
            "key-tom": { ownerId: "tom", name: "Tom's reader", permissions: ["jobs:read"], ownerPermissions: ["jobs:read"] },
        };

        beforeEach(() => {
            mocks.keys.ownerOf.mockImplementation(async (id: string) => KEYS[id]);
            mocks.keys.getById.mockImplementation(async (id: string) => ({ id, name: KEYS[id].name, prefix: "dbackup_12345678" }));
            mocks.keys.toggle.mockImplementation(async (id: string, enabled: boolean) => ({ id, name: KEYS[id].name, enabled }));
            mocks.keys.deleteMany.mockImplementation(async (ids: string[], guard?: (id: string) => Promise<void>) => bulkWith(ids, guard));
            mocks.keys.toggleMany.mockImplementation(async (ids: string[], _enabled: boolean, guard?: (id: string) => Promise<void>) => bulkWith(ids, guard));
        });

        it("refuses someone whose group may do less than the key, for one key and in bulk", async () => {
            mocks.viewer = viewer("tom", "Tom Weber", ["jobs:read", "api-keys:write"]);

            expect(await toggleApiKey("key-lena", false)).toEqual({ success: false, error: "The key may run jobs and see the history, which your group may not, so only its owner pauses it." });
            expect(await deleteApiKey("key-lena")).toEqual({ success: false, error: "The key may run jobs and see the history, which your group may not, so only its owner deletes it." });
            expect(mocks.keys.toggle).not.toHaveBeenCalled();
            expect(mocks.keys.delete).not.toHaveBeenCalled();

            const deleted = await bulkDeleteApiKeys(["key-lena", "key-tom"]);
            expect(deleted).toMatchObject({ success: true, data: { succeeded: ["key-tom"], failed: [{ id: "key-lena", error: expect.stringMatching(/only its owner deletes it/) }] } });
            const paused = await bulkToggleApiKeys(["key-lena", "key-tom"], false);
            expect(paused).toMatchObject({ success: true, data: { succeeded: ["key-tom"], failed: [{ id: "key-lena", error: expect.stringMatching(/only its owner pauses it/) }] } });
        });

        it("lets the owner and someone who may do all the key may do pause and delete it", async () => {
            mocks.viewer = viewer("lena", "Lena Graf", OPERATORS);
            expect(await toggleApiKey("key-lena", false)).toMatchObject({ success: true });

            mocks.viewer = viewer("ada", "Ada", [...OPERATORS, "api-keys:write"]);
            expect(await deleteApiKey("key-lena")).toEqual({ success: true });
            expect(mocks.keys.delete).toHaveBeenCalledWith("key-lena");
        });

        it("refuses ids and a switch that are no strings and no boolean before anything is read", async () => {
            expect(await toggleApiKey("", true)).toEqual({ success: false, error: "Invalid request" });
            expect(await toggleApiKey("key-lena", "yes" as unknown as boolean)).toEqual({ success: false, error: "Invalid request" });
            expect(await deleteApiKey({ id: "key-lena" } as unknown as string)).toEqual({ success: false, error: "Invalid request" });
            expect(await bulkToggleApiKeys(["key-lena"], "no" as unknown as boolean)).toEqual({ success: false, error: "Invalid request" });
            expect(mocks.keys.ownerOf).not.toHaveBeenCalled();
        });
    });
});
