import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, PermissionError } from "@/lib/logging/errors";

type Entry = { id: string; kind: string; recordId: string; name: string; permission: string; superAdminOnly: boolean; deletedById: string | null; deletedAt: Date };

const mocks = vi.hoisted(() => ({
    viewer: null as { id: string; group: { name: string } | null } | null,
    permissions: [] as string[],
    entries: [] as Entry[],
    restore: vi.fn(),
    purge: vi.fn(),
    latest: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", async () => {
    const { AuthenticationError: NotSignedIn, PermissionError: NotAllowed } = await vi.importActual<typeof import("@/lib/logging/errors")>("@/lib/logging/errors");
    return {
        checkPermission: vi.fn(async (permission: string) => {
            if (!mocks.viewer) throw new NotSignedIn();
            if (mocks.viewer.group?.name !== "SuperAdmin" && !mocks.permissions.includes(permission)) throw new NotAllowed(permission);
            return mocks.viewer;
        }),
        getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
        getUserPermissions: vi.fn(async () => mocks.permissions),
    };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/trash/trash-service", async () => {
    const actual = await vi.importActual<typeof import("@/services/trash/trash-service")>("@/services/trash/trash-service");
    return {
        mayHandle: actual.mayHandle,
        trashEntries: vi.fn(async (ids: string[]) => mocks.entries.filter((entry) => ids.includes(entry.id))),
        latestTrashIds: mocks.latest,
        restoreFromTrash: mocks.restore,
        purgeFromTrash: mocks.purge,
    };
});

const { purgeDeletedAction, restoreDeletedAction, undoDeleteAction } = await import("@/app/actions/settings/trash");

const now = () => new Date();
const KEY: Entry = { id: "t-key", kind: "encryptionKey", recordId: "key-1", name: "Offsite 2025", permission: "vault:write", superAdminOnly: false, deletedById: "lena", deletedAt: now() };
const ROOT: Entry = { id: "t-root", kind: "user", recordId: "u-root", name: "Root", permission: "users:write", superAdminOnly: true, deletedById: "lena", deletedAt: now() };
const JOB: Entry = { id: "t-job", kind: "job", recordId: "job-1", name: "Shop nightly", permission: "jobs:write", superAdminOnly: false, deletedById: "lena", deletedAt: now() };

describe("the actions of Recently deleted", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = { id: "lena", group: { name: "Admins" } };
        mocks.permissions = ["settings:write", "vault:write", "users:write"];
        mocks.entries = [KEY, ROOT, JOB];
        mocks.restore.mockImplementation(async (ids: string[]) => ({
            restored: ids.map((id) => ({ id, recordId: `r-${id}`, kind: mocks.entries.find((entry) => entry.id === id)!.kind, name: "back", notes: [] })),
            conflicts: [],
            failed: [],
        }));
        mocks.purge.mockImplementation(async (ids: string[]) => ids.length);
    });

    it("refuses a viewer who is not signed in before reading anything", async () => {
        mocks.viewer = null;

        await expect(restoreDeletedAction(["t-key"])).rejects.toBeInstanceOf(AuthenticationError);
        await expect(purgeDeletedAction(["t-key"])).rejects.toBeInstanceOf(AuthenticationError);
        await expect(undoDeleteAction("job", ["job-1"])).rejects.toBeInstanceOf(AuthenticationError);
        expect(mocks.restore).not.toHaveBeenCalled();
    });

    it("leaves restoring and deleting for good to someone who may change the settings", async () => {
        mocks.permissions = ["vault:write", "users:write", "settings:read"];

        await expect(restoreDeletedAction(["t-key"])).rejects.toBeInstanceOf(PermissionError);
        await expect(purgeDeletedAction(["t-key"])).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.restore).not.toHaveBeenCalled();
        expect(mocks.purge).not.toHaveBeenCalled();
    });

    it("restores only what the viewer may change, and tells nothing about the rest", async () => {
        const result = await restoreDeletedAction(["t-key", "t-job", "t-root"]);

        // A job needs jobs:write, and a SuperAdmin's account needs a SuperAdmin.
        expect(mocks.restore).toHaveBeenCalledWith(["t-key"], { newName: undefined });
        expect(result).toMatchObject({
            success: true,
            data: {
                failed: [
                    { id: "t-job", error: "It is not in Recently deleted any more." },
                    { id: "t-root", error: "It is not in Recently deleted any more." },
                ],
            },
        });
        expect(mocks.audit).toHaveBeenCalledWith("lena", "RESTORE", "VAULT", { name: "back", action: "trash_restore", originalName: "Offsite 2025" }, "r-t-key");
    });

    it("lets a SuperAdmin bring back the account of a SuperAdmin", async () => {
        mocks.viewer = { id: "root-2", group: { name: "SuperAdmin" } };

        await restoreDeletedAction(["t-root"]);

        expect(mocks.restore).toHaveBeenCalledWith(["t-root"], { newName: undefined });
    });

    it("asks for a valid email when a user is restored under another one", async () => {
        mocks.entries = [{ ...ROOT, superAdminOnly: false }];

        expect(await restoreDeletedAction(["t-root"], "not an email")).toEqual({ success: false, error: "An account needs a valid email." });
        expect(mocks.restore).not.toHaveBeenCalled();
    });

    it("deletes for good only what the viewer may change, with an entry for each", async () => {
        const result = await purgeDeletedAction(["t-key", "t-job"]);

        expect(mocks.purge).toHaveBeenCalledWith(["t-key"]);
        expect(result).toEqual({ success: true, data: { purged: ["t-key"] } });
        expect(mocks.audit).toHaveBeenCalledWith("lena", "DELETE", "VAULT", { name: "Offsite 2025", action: "trash_purge", permanently: true }, "key-1");
    });

    it("undoes the viewer's own delete of the last minutes without the right to change the settings", async () => {
        mocks.permissions = ["jobs:write"];
        mocks.latest.mockResolvedValue(["t-job"]);

        await undoDeleteAction("job", ["job-1"]);

        expect(mocks.latest).toHaveBeenLastCalledWith("job", ["job-1"]);
        expect(mocks.restore).toHaveBeenCalledWith(["t-job"]);
    });

    it("is no way around the settings for a delete of someone else or one from long ago", async () => {
        mocks.permissions = ["jobs:write"];
        mocks.latest.mockResolvedValue(["t-job"]);
        const refused = { success: false, error: "It can no longer be undone. Someone who may change the settings restores it under Settings, Recently deleted." };

        mocks.entries = [{ ...JOB, deletedById: "tom" }];
        expect(await undoDeleteAction("job", ["job-1"])).toEqual(refused);

        mocks.entries = [{ ...JOB, deletedAt: new Date(Date.now() - 60 * 60 * 1000) }];
        expect(await undoDeleteAction("job", ["job-1"])).toEqual(refused);

        mocks.permissions = [];
        mocks.entries = [JOB];
        expect(await undoDeleteAction("job", ["job-1"])).toEqual(refused);
        expect(mocks.restore).not.toHaveBeenCalled();
    });

    it("refuses a kind Recently deleted does not keep", async () => {
        expect(await undoDeleteAction("group" as never, ["g-1"])).toEqual({ success: false, error: "Invalid request" });
        expect(mocks.latest).not.toHaveBeenCalled();
    });
});
