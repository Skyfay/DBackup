// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CONFIG_UPLOAD_MAX_BYTES } from "@/lib/core/config-upload";
import { EncryptionKeyRequiredError, PermissionError, ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    context: vi.fn(),
    checkUpload: vi.fn(),
    checkStored: vi.fn(),
    apply: vi.fn(),
    noAccountYet: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.context()),
    checkPermissionWithContext: vi.fn((ctx: { permissions: string[]; isSuperAdmin: boolean }, permission: string) => {
        if (!ctx.isSuperAdmin && !ctx.permissions.includes(permission)) throw new PermissionError(permission);
    }),
}));
vi.mock("@/services/config/restore-flow", () => ({
    checkUploadedBackup: (...args: unknown[]) => mocks.checkUpload(...args),
    checkStoredBackup: (...args: unknown[]) => mocks.checkStored(...args),
    applyCheckedRestore: (...args: unknown[]) => mocks.apply(...args),
    hasNoAccountYet: () => mocks.noAccountYet(),
    keyOverride: (keyHex?: string, profileId?: string) => (keyHex ? { rawKeyHex: keyHex } : profileId ? { profileId } : undefined),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const upload = await import("@/app/api/settings/config-backup/restore/route");
const apply = await import("@/app/api/settings/config-backup/restore/apply/route");
const destination = await import("@/app/api/settings/config-backup/restore/destination/route");
const setup = await import("@/app/api/setup/restore/route");
const setupApply = await import("@/app/api/setup/restore/apply/route");

const BASE = "https://dbackup.test/api";
const SUPER_ADMIN = { userId: "root", permissions: [], isSuperAdmin: true, authMethod: "session" };
const SETTINGS_ADMIN = { userId: "lena", permissions: ["settings:write"], isSuperAdmin: false, authMethod: "session" };
const API_KEY = { userId: "root", permissions: ["settings:write"], isSuperAdmin: false, authMethod: "apikey", apiKeyId: "key-1" };
const PREVIEW = { kind: "database", version: "3.4.0", createdAt: "2026-09-29T03:00:00.000Z", counts: { connections: 3, jobs: 2, templates: 5, users: 2, runs: 0 }, otherKeys: false };

function form(fields: Record<string, string> = {}) {
    const body = new FormData();
    body.set("backupFile", new File(["x"], "config_backup.db.gz.enc"));
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return body;
}
const postForm = (path: string, body: FormData) => new NextRequest(`${BASE}${path}`, { method: "POST", body });
const postJson = (path: string, body: object) => new NextRequest(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkUpload.mockResolvedValue({ token: "t-1", fileName: "config_backup.db.gz.enc", preview: PREVIEW });
    mocks.checkStored.mockResolvedValue({ token: "t-2", fileName: "config_backup.db.gz.enc", preview: PREVIEW });
    mocks.apply.mockResolvedValue({ kind: "database", fileName: "config_backup.db.gz.enc" });
    mocks.noAccountYet.mockResolvedValue(true);
});

describe("the restore routes in Settings", () => {
    it("are for a signed-in SuperAdmin only, never an API key, since a restore could make anyone a SuperAdmin", async () => {
        for (const ctx of [SETTINGS_ADMIN, API_KEY]) {
            mocks.context.mockReturnValue(ctx);
            expect((await upload.POST(postForm("/settings/config-backup/restore", form()))).status).toBe(403);
            expect((await apply.POST(postJson("/settings/config-backup/restore/apply", { token: "t-1" }))).status).toBe(403);
            expect((await destination.POST(postJson("/settings/config-backup/restore/destination", { destinationId: "nas", file: "f" }))).status).toBe(403);
        }
        expect(mocks.checkUpload).not.toHaveBeenCalled();
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(mocks.checkStored).not.toHaveBeenCalled();
    });

    it("answer a caller who is not signed in with 401, and need the right to change the settings", async () => {
        mocks.context.mockReturnValue(null);
        expect((await upload.POST(postForm("/settings/config-backup/restore", form()))).status).toBe(401);

        mocks.context.mockReturnValue({ userId: "max", permissions: [], isSuperAdmin: false, authMethod: "session" });
        await expect(apply.POST(postJson("/settings/config-backup/restore/apply", { token: "t-1" }))).rejects.toBeInstanceOf(PermissionError);
    });

    it("refuse an upload the middleware would cut off, before reading it", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);
        const request = new NextRequest(`${BASE}/settings/config-backup/restore`, { method: "POST", body: "x", headers: { "content-length": String(CONFIG_UPLOAD_MAX_BYTES + 1) } });

        const response = await upload.POST(request);

        expect(response.status).toBe(413);
        expect((await response.json()).error).toContain("Backups page");
        expect(mocks.checkUpload).not.toHaveBeenCalled();
    });

    it("check an upload with the key from the recovery dialog and answer with what it holds", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);

        const response = await upload.POST(postForm("/settings/config-backup/restore", form({ encryptionKeyHex: "ab12" })));

        expect(await response.json()).toEqual({ success: true, data: { token: "t-1", fileName: "config_backup.db.gz.enc", preview: PREVIEW } });
        expect(mocks.checkUpload).toHaveBeenCalledWith(expect.objectContaining({ keyHex: "ab12", profileId: null, meta: null }), { userId: "root" });
    });

    it("ask for the key when the file needs one nobody gave", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);
        mocks.checkUpload.mockRejectedValue(new EncryptionKeyRequiredError("No key opens this file", "profile-1"));

        const response = await upload.POST(postForm("/settings/config-backup/restore", form()));

        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ code: "ENCRYPTION_KEY_REQUIRED", profileId: "profile-1" });
    });

    it("answer a file that is no backup with its reason", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);
        mocks.checkUpload.mockRejectedValue(new ValidationError("The backup comes from a newer DBackup, v9.0.0. Update this one first, then restore it."));

        const response = await upload.POST(postForm("/settings/config-backup/restore", form()));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("newer DBackup");
    });

    it("check a backup at a destination on the server, with a key of the Vault", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);

        const response = await destination.POST(postJson("/settings/config-backup/restore/destination", { destinationId: "nas", file: "config-backups/config_backup.db.gz.enc", profileId: "key-1" }));

        expect((await response.json()).data.token).toBe("t-2");
        expect(mocks.checkStored).toHaveBeenCalledWith("nas", "config-backups/config_backup.db.gz.enc", { profileId: "key-1" }, { userId: "root" });
    });

    it("restore a checked copy, write the audit log and say DBackup restarts", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);

        const response = await apply.POST(postJson("/settings/config-backup/restore/apply", { token: "t-1" }));

        expect(await response.json()).toEqual({ success: true, data: { restarting: true } });
        expect(mocks.apply).toHaveBeenCalledWith("t-1", { userId: "root" });
        expect(mocks.audit).toHaveBeenCalledWith(SUPER_ADMIN, "RESTORE", "SYSTEM", { action: "config_restore", file: "config_backup.db.gz.enc", kind: "database" });
    });

    it("hand back what a file of an older version could not bring back", async () => {
        mocks.context.mockReturnValue(SUPER_ADMIN);
        mocks.apply.mockResolvedValue({ kind: "json", fileName: "config_backup.json.gz.enc", notes: ["1 job is paused"] });

        const response = await apply.POST(postJson("/settings/config-backup/restore/apply", { token: "t-1" }));

        expect(await response.json()).toEqual({ success: true, data: { notes: ["1 job is paused"] } });
    });
});

describe("the restore on the sign-up page", () => {
    it("is open only while DBackup has no account, and says so before reading the body", async () => {
        mocks.noAccountYet.mockResolvedValue(false);

        expect((await setup.POST(postForm("/setup/restore", form()))).status).toBe(403);
        expect((await setupApply.POST(postJson("/setup/restore/apply", { token: "t-1" }))).status).toBe(403);
        expect(mocks.checkUpload).not.toHaveBeenCalled();
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it("checks and restores a backup with the key from its recovery kit while there is no account", async () => {
        const checked = await setup.POST(postForm("/setup/restore", form({ encryptionKeyHex: "cd34" })));
        expect((await checked.json()).data.token).toBe("t-1");
        expect(mocks.checkUpload).toHaveBeenCalledWith(expect.objectContaining({ keyHex: "cd34" }), "setup");

        const restored = await setupApply.POST(postJson("/setup/restore/apply", { token: "t-1" }));
        expect(await restored.json()).toEqual({ success: true, data: { restarting: true } });
        expect(mocks.apply).toHaveBeenCalledWith("t-1", "setup");
    });
});
