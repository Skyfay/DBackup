/**
 * What editing a connection writes to the audit log: the fields that changed with their values,
 * and a changed secret only as changed, never with a value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.stubEnv("ENCRYPTION_KEY", "c".repeat(64));

const mocks = vi.hoisted(() => ({
    ctx: { userId: "u1", permissions: [], isSuperAdmin: true, authMethod: "session" },
    findUnique: vi.fn(),
    update: vi.fn(),
    profiles: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    checkPermissionWithContext: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));
vi.mock("@/lib/adapters/credential-validation", () => ({ validateCredentialAssignments: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findUnique: (...args: unknown[]) => mocks.findUnique(...args),
            findFirst: vi.fn().mockResolvedValue(null),
            update: (...args: unknown[]) => mocks.update(...args),
        },
        credentialProfile: { findMany: (...args: unknown[]) => mocks.profiles(...args) },
    },
}));

import { encryptConfig } from "@/lib/crypto";
const { PUT } = await import("@/app/api/adapters/[id]/route");

const SAVED = { host: "db.local", port: 3306, user: "backup", password: "old-database-password" };

/** The connection as stored, its secrets encrypted. */
function stored(overrides: Record<string, unknown> = {}) {
    return {
        id: "a-1",
        name: "Shop DB",
        type: "database",
        adapterId: "mysql",
        config: JSON.stringify(encryptConfig(SAVED)),
        metadata: null,
        primaryCredentialId: null,
        sshCredentialId: null,
        storageRole: "DESTINATION",
        lastError: null,
        lastStatus: "ONLINE",
        lastHealthCheck: null,
        consecutiveFailures: 0,
        defaultRetentionPolicyId: null,
        createdAt: new Date("2026-09-01T10:00:00Z"),
        updatedAt: new Date("2026-09-01T10:00:00Z"),
        ...overrides,
    };
}

const edit = (body: Record<string, unknown>) =>
    PUT(new NextRequest("http://localhost/api/adapters/a-1", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "a-1" }) });

describe("the audit entry of an edited connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue(stored());
        mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => stored(data));
    });

    it("marks a changed password as changed without either value and writes the other fields with theirs", async () => {
        const response = await edit({ name: "Shop DB", config: { ...SAVED, host: "db2.local", password: "new-database-password" } });

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "ADAPTER", {
            name: "Shop DB",
            changes: [
                { field: "Host", from: "db.local", to: "db2.local" },
                { field: "Password", from: null, to: null, secret: true },
            ],
        }, "a-1");
        const written = JSON.stringify(mocks.logFor.mock.calls);
        expect(written).not.toContain("old-database-password");
        expect(written).not.toContain("new-database-password");
    });

    it("writes no change for a password left blank, which keeps the saved one", async () => {
        await edit({ name: "Shop DB", config: { ...SAVED, password: "" } });

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "ADAPTER", { name: "Shop DB", changes: [] }, "a-1");
    });

    it("names a new login by its profile and keeps the old name after a rename", async () => {
        mocks.findUnique.mockResolvedValue(stored({ primaryCredentialId: "p-old" }));
        mocks.profiles.mockResolvedValue([{ id: "p-old", name: "Old login" }, { id: "p-new", name: "Shop login" }]);

        await edit({ name: "Shop DB (EU)", primaryCredentialId: "p-new" });

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "ADAPTER", {
            name: "Shop DB (EU)",
            renamedFrom: "Shop DB",
            changes: [{ field: "Login", from: "Old login", to: "Shop login" }],
        }, "a-1");
    });

    it("writes a switch of the form the way round it reads", async () => {
        await edit({ name: "Shop DB", metadata: { healthNotificationsDisabled: true, isRestoreExcluded: false } });

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "ADAPTER", {
            name: "Shop DB",
            changes: [{ field: "Health alerts", from: "On", to: "Off" }],
        }, "a-1");
    });
});
