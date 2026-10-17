// @vitest-environment node
/**
 * Invitation links against a real SQLite database migrated with the migrations of this version: a
 * link adds someone to its tenant once, with the group it names, and stops working once it is used,
 * ran out, was taken back or failed too often to make an account.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "@/lib/logging/errors";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const mocks = vi.hoisted(() => ({ createUser: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { createUser: mocks.createUser } }));

const { invitationService, MAX_FAILED_SIGN_UPS } = await import("@/services/tenant/invitation-service");

let root = "";
let base: PrismaClient;
const now = new Date("2026-10-15T10:00:00.000Z");

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-invites-"));
    const file = path.join(root, "invites.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null)) as unknown as PrismaClient;

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.group.create({ data: { id: "g-ops", name: "Operators", permissions: "[]" } });
    await base.group.create({ data: { id: "g-view", name: "Viewers", permissions: "[]" } });
    await base.user.create({ data: { id: "u-admin", name: "Admin", email: "admin@example.ch", emailVerified: true, createdAt: now, updatedAt: now } });
    await base.user.create({ data: { id: "u-lena", name: "Lena", email: "lena@example.ch", emailVerified: true, createdAt: now, updatedAt: now } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    // Better Auth makes the account, here the row it would write.
    mocks.createUser.mockImplementation(async (data: { name: string; email: string }) => {
        const user = await base.user.create({ data: { id: `u-${data.email}`, name: data.name, email: data.email, emailVerified: true, createdAt: now, updatedAt: now } });
        return { user };
    });
});

const invite = (groupId = "g-ops") => invitationService.create({ tenantId: "acme", groupId, note: "For Lena", createdById: "u-admin", createdByName: "Admin" });

describe("an invitation link", () => {
    it("keeps only the hash of its token and lists itself as open", async () => {
        const { token, id } = await invite();
        const row = await base.tenantInvitation.findUniqueOrThrow({ where: { id } });
        expect(row.tokenHash).not.toContain(token);
        expect((await invitationService.list("acme")).map((entry) => entry.id)).toContain(id);
        expect(await invitationService.list("default")).toEqual([]);
    });

    it("shows its tenant and group before anyone joins", async () => {
        const { token } = await invite();
        expect(await invitationService.preview(token)).toEqual(expect.objectContaining({ tenantId: "acme", tenantName: "Acme", groupName: "Operators" }));
        expect(await invitationService.preview("not-a-token-of-anyone-at-all")).toBeNull();
    });

    it("adds an existing account with its group once, and then stops working", async () => {
        const { token } = await invite();
        expect(await invitationService.accept(token, "u-lena")).toEqual({ tenantId: "acme", tenantName: "Acme", joined: true });
        expect(await base.tenantMembership.findUnique({ where: { userId_tenantId: { userId: "u-lena", tenantId: "acme" } } })).toEqual(expect.objectContaining({ groupId: "g-ops" }));
        await expect(invitationService.accept(token, "u-lena")).rejects.toBeInstanceOf(NotFoundError);
        expect(await invitationService.preview(token)).toBeNull();
    });

    it("keeps the group of someone who is a member already", async () => {
        const { token } = await invite("g-view");
        expect(await invitationService.accept(token, "u-lena")).toEqual(expect.objectContaining({ joined: false }));
        expect((await base.tenantMembership.findUniqueOrThrow({ where: { userId_tenantId: { userId: "u-lena", tenantId: "acme" } } })).groupId).toBe("g-ops");
    });

    it("works no more once it ran out or was taken back", async () => {
        const expired = await invite();
        await base.tenantInvitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
        expect(await invitationService.preview(expired.token)).toBeNull();

        const revoked = await invite();
        await expect(invitationService.revoke(revoked.id, "default")).rejects.toBeInstanceOf(NotFoundError);
        await invitationService.revoke(revoked.id, "acme");
        expect(await invitationService.preview(revoked.token)).toBeNull();
    });

    it("makes a new account and adds it to the tenant", async () => {
        const { token } = await invite();
        const accepted = await invitationService.acceptWithNewAccount(token, { name: "Nora", email: "Nora@Example.ch", password: "Harbor-Lamp-42" });
        expect(accepted).toEqual(expect.objectContaining({ tenantId: "acme", email: "nora@example.ch" }));
        expect(await base.tenantMembership.count({ where: { userId: accepted.userId, tenantId: "acme" } })).toBe(1);
        // Better Auth signs a new account in on the server, where no browser gets the session.
        expect(await base.session.count({ where: { userId: accepted.userId } })).toBe(0);
    });

    it("is spent after too many failed accounts, so it is no tool to try one email after the other", async () => {
        const { token } = await invite();
        for (let attempt = 1; attempt < MAX_FAILED_SIGN_UPS; attempt++) {
            await expect(invitationService.acceptWithNewAccount(token, { name: "Probe", email: "lena@example.ch", password: "x" })).rejects.toBeInstanceOf(ConflictError);
            expect(await invitationService.preview(token)).not.toBeNull();
        }
        await expect(invitationService.acceptWithNewAccount(token, { name: "Probe", email: "lena@example.ch", password: "x" })).rejects.toBeInstanceOf(ConflictError);
        expect(await invitationService.preview(token)).toBeNull();
        expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it("makes one account of two requests at once, and leaves no account without a tenant", async () => {
        const { token } = await invite();
        const results = await Promise.allSettled([
            invitationService.acceptWithNewAccount(token, { name: "Ann", email: "ann@example.ch", password: "Harbor-Lamp-42" }),
            invitationService.acceptWithNewAccount(token, { name: "Ben", email: "ben@example.ch", password: "Harbor-Lamp-42" }),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(mocks.createUser).toHaveBeenCalledTimes(1);
        const made = await base.user.findMany({ where: { email: { in: ["ann@example.ch", "ben@example.ch"] } }, select: { memberships: { select: { tenantId: true } } } });
        expect(made).toHaveLength(1);
        expect(made[0].memberships).toEqual([{ tenantId: "acme" }]);
    });

    it("opens the link again when the account could not be made", async () => {
        const { token } = await invite();
        mocks.createUser.mockRejectedValueOnce(new Error("Password too short"));
        await expect(invitationService.acceptWithNewAccount(token, { name: "Cleo", email: "cleo@example.ch", password: "x" })).rejects.toThrow("Password too short");
        expect(await invitationService.preview(token)).not.toBeNull();
    });

    it("stops working once whoever made it may no longer give its group", async () => {
        await base.group.create({ data: { id: "g-jobs", name: "Job runners", permissions: JSON.stringify(["jobs:read", "jobs:execute"]), tenantId: "acme" } });
        const { token } = await invite("g-jobs");
        // The admin holds no group in Acme, so the link of a group with rights gives nothing.
        expect(await invitationService.preview(token)).toBeNull();

        await base.group.create({ data: { id: "g-admins", name: "Admins", permissions: "[]", fullAccess: true, tenantId: "acme" } });
        await base.tenantMembership.create({ data: { userId: "u-admin", tenantId: "acme", groupId: "g-admins" } });
        expect(await invitationService.preview(token)).not.toBeNull();
    });
});
