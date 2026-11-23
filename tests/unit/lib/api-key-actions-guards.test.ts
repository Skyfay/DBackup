import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { LATER_END_REFUSAL, PERMISSIONS_REFUSAL, RESUME_REFUSAL, ROTATE_REFUSAL } from "@/lib/auth/api-key-change-rule";

type Viewer = { id: string; name: string; isPlatformAdmin: boolean; permissions: string[]; tenantId: string | null };

const mocks = vi.hoisted(() => ({
    denied: new Set<string>(),
    viewer: null as Viewer | null,
    keys: {
        create: vi.fn(), update: vi.fn(), rotate: vi.fn(), ownerOf: vi.fn(), nameTaken: vi.fn(), ceilingFor: vi.fn(),
        toggle: vi.fn(), delete: vi.fn(), getById: vi.fn(), list: vi.fn(),
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
        mocks.keys.list.mockResolvedValue([]);
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

    it("keeps the end of a key before and after in the audit log", async () => {
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute"], ownerPermissions: OPERATORS });
        mocks.keys.update.mockResolvedValue({ before: { name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: null }, after: {} });

        expect(await updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: IN_90_DAYS })).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("lena", "UPDATE", "API_KEY", expect.objectContaining({
            changes: [{ field: "Expires", from: "Never", to: "2026-12-28 10:00 UTC" }],
        }), "key-1");
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
        // The ceiling of Lena's keys is wider than what she may do in this tenant right now.
        mocks.viewer = viewer("lena", "Lena Graf", ["jobs:read"]);
        mocks.keys.ownerOf.mockResolvedValue({ ownerId: "lena", name: "CI pipeline", permissions: ["jobs:read"], ownerPermissions: OPERATORS });

        const result = await updateApiKey("key-1", { name: "CI pipeline", permissions: ["jobs:read", "jobs:execute"], expiresAt: null });

        expect(result).toEqual({ success: false, error: "Your group may not run jobs, so you cannot give it to a key." });
    });

    it("answers an error of the database with a fixed sentence and a key that is gone in words", async () => {
        const { NotFoundError } = await import("@/lib/logging/errors");
        mocks.keys.create.mockRejectedValue(new Error("SQLITE_BUSY: database is locked at /data/dbackup.db"));
        const created = await createApiKey({ name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: null });
        expect(created).toEqual({ success: false, error: expect.stringMatching(/server log has the details/) });
        expect(JSON.stringify(created)).not.toContain("SQLITE");

        mocks.keys.ownerOf.mockRejectedValue(new NotFoundError("ApiKey", "key-gone"));
        mocks.keys.getById.mockRejectedValue(new NotFoundError("ApiKey", "key-gone"));
        expect(await rotateApiKey("key-gone")).toEqual({ success: false, error: "The key no longer exists." });
        expect(await deleteApiKey("key-gone")).toEqual({ success: false, error: "The key no longer exists." });
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

    describe("a key of someone else", () => {
        const IN_30_DAYS = new Date("2026-11-28T10:00:00.000Z");
        const IN_60_DAYS = "2026-12-28T10:00:00.000Z";
        /** A key of a platform admin that never runs out, and Lena's key that runs out in 60 days. */
        const KEYS: Record<string, { ownerId: string; name: string; permissions: string[]; ownerPermissions: string[]; expiresAt: Date | null }> = {
            "key-root": { ownerId: "root", name: "Root automation", permissions: ["platform-accounts:write", "jobs:read"], ownerPermissions: ["platform-accounts:write", "jobs:read"], expiresAt: null },
            "key-lena": { ownerId: "lena", name: "CI pipeline", permissions: ["jobs:execute", "history:read"], ownerPermissions: OPERATORS, expiresAt: new Date(IN_60_DAYS) },
        };
        /** Tom may do everything a group gives, every key's rights included, but he is no platform admin. */
        const tom = () => viewer("tom", "Tom Weber", AVAILABLE_PERMISSIONS.map((permission) => permission.id));

        beforeEach(() => {
            mocks.keys.ownerOf.mockImplementation(async (id: string) => KEYS[id]);
            mocks.keys.getById.mockImplementation(async (id: string) => ({ id, name: KEYS[id].name, prefix: "dbackup_12345678", expiresAt: KEYS[id].expiresAt }));
            mocks.keys.update.mockImplementation(async (id: string) => ({ before: { name: KEYS[id].name, permissions: KEYS[id].permissions, expiresAt: KEYS[id].expiresAt }, after: {} }));
            mocks.keys.rotate.mockImplementation(async (id: string) => ({ apiKey: { id, name: KEYS[id].name }, rawKey: "dbackup_new" }));
            mocks.keys.toggle.mockImplementation(async (id: string, enabled: boolean) => ({ id, name: KEYS[id].name, enabled }));
            mocks.keys.deleteMany.mockImplementation(async (ids: string[], guard?: (id: string) => Promise<void>) => bulkWith(ids, guard));
            mocks.keys.toggleMany.mockImplementation(async (ids: string[], _enabled: boolean, guard?: (id: string) => Promise<void>) => bulkWith(ids, guard));
            mocks.keys.list.mockImplementation(async () => Object.entries(KEYS).map(([id, key]) => ({ id, name: key.name })));
            mocks.viewer = tom();
        });

        it("is never rotated, widened, narrowed, extended or enabled again by anyone but its owner and a platform admin, whatever their rights", async () => {
            for (const [id, key] of Object.entries(KEYS)) {
                const end = key.expiresAt?.toISOString() ?? null;
                expect(await rotateApiKey(id)).toEqual({ success: false, error: ROTATE_REFUSAL });
                expect(await updateApiKey(id, { name: key.name, permissions: [...key.permissions, "storage:delete"], expiresAt: end })).toEqual({ success: false, error: PERMISSIONS_REFUSAL });
                expect(await updateApiKey(id, { name: key.name, permissions: key.permissions.slice(1), expiresAt: end })).toEqual({ success: false, error: PERMISSIONS_REFUSAL });
                expect(await toggleApiKey(id, true)).toEqual({ success: false, error: RESUME_REFUSAL });
            }
            // A later end, or none, lets the key of Lena run longer.
            expect(await updateApiKey("key-lena", { name: "CI pipeline", permissions: KEYS["key-lena"].permissions, expiresAt: "2027-06-01T10:00:00.000Z" })).toEqual({ success: false, error: LATER_END_REFUSAL });
            expect(await updateApiKey("key-lena", { name: "CI pipeline", permissions: KEYS["key-lena"].permissions, expiresAt: null })).toEqual({ success: false, error: LATER_END_REFUSAL });
            const enabled = await bulkToggleApiKeys(["key-root", "key-lena"], true);
            expect(enabled).toMatchObject({ success: true, data: { succeeded: [], failed: [{ id: "key-root", error: RESUME_REFUSAL }, { id: "key-lena", error: RESUME_REFUSAL }] } });

            expect(mocks.keys.rotate).not.toHaveBeenCalled();
            expect(mocks.keys.update).not.toHaveBeenCalled();
            expect(mocks.keys.toggle).not.toHaveBeenCalled();
        });

        it("is disabled, deleted, renamed and made to run out sooner by anyone who may change API keys", async () => {
            mocks.viewer = viewer("tom", "Tom Weber", ["api-keys:write"]);

            expect(await updateApiKey("key-root", { name: "Root renamed", permissions: KEYS["key-root"].permissions, expiresAt: null })).toEqual({ success: true });
            expect(mocks.keys.update).toHaveBeenLastCalledWith("key-root", { name: "Root renamed", permissions: KEYS["key-root"].permissions, expiresAt: null });
            expect(await updateApiKey("key-root", { name: "Root automation", permissions: KEYS["key-root"].permissions, expiresAt: IN_60_DAYS })).toEqual({ success: true });
            expect(await updateApiKey("key-lena", { name: "CI pipeline", permissions: KEYS["key-lena"].permissions, expiresAt: IN_30_DAYS.toISOString() })).toEqual({ success: true });
            expect(mocks.keys.update).toHaveBeenLastCalledWith("key-lena", { name: "CI pipeline", permissions: KEYS["key-lena"].permissions, expiresAt: IN_30_DAYS });

            expect(await toggleApiKey("key-root", false)).toMatchObject({ success: true });
            expect(await deleteApiKey("key-root")).toEqual({ success: true });
            expect(mocks.keys.delete).toHaveBeenCalledWith("key-root");
            const paused = await bulkToggleApiKeys(["key-root", "key-lena"], false);
            expect(paused).toMatchObject({ success: true, data: { succeeded: ["key-root", "key-lena"], failed: [] } });
            const deleted = await bulkDeleteApiKeys(["key-root", "key-lena"]);
            expect(deleted).toMatchObject({ success: true, data: { succeeded: ["key-root", "key-lena"], failed: [] } });
            expect(mocks.audit).toHaveBeenCalledWith("tom", "DELETE", "API_KEY", expect.objectContaining({ bulk: true, succeeded: 2, names: ["Root automation", "CI pipeline"] }));
        });

        it("is rotated, enabled again and changed in full by its owner and by a platform admin", async () => {
            mocks.viewer = viewer("lena", "Lena Graf", OPERATORS);
            expect(await rotateApiKey("key-lena")).toEqual({ success: true, data: { apiKey: { id: "key-lena", name: "CI pipeline" }, rawKey: "dbackup_new" } });
            expect(await toggleApiKey("key-lena", true)).toMatchObject({ success: true });
            expect(await updateApiKey("key-lena", { name: "CI pipeline", permissions: [...KEYS["key-lena"].permissions, "jobs:read"], expiresAt: null })).toEqual({ success: true });

            mocks.viewer = viewer("manu", "Manu", AVAILABLE_PERMISSIONS.map((permission) => permission.id), true);
            expect(await rotateApiKey("key-root")).toMatchObject({ success: true });
            expect(await toggleApiKey("key-lena", true)).toMatchObject({ success: true });
            expect(await updateApiKey("key-lena", { name: "CI pipeline", permissions: ["jobs:execute"], expiresAt: "2027-06-01T10:00:00.000Z" })).toEqual({ success: true });
            // Still never beyond the group of its owner, also from a platform admin.
            expect(await updateApiKey("key-lena", { name: "CI pipeline", permissions: ["jobs:execute", "storage:delete"], expiresAt: null }))
                .toEqual({ success: false, error: "The group of its owner may not delete backups, so the key may not either." });
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
