// @vitest-environment node
/**
 * Groups the platform makes once for tenants, against a real SQLite database migrated with the
 * migrations of this version: a real group in every tenant it reaches that follows its name and
 * permissions, a tenant with a group of its own by the name taken over or left out, a tenant it
 * leaves losing the group or keeping it, and a new tenant getting the ones for every tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ConflictError, ValidationError } from "@/lib/logging/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const app = vi.hoisted(() => ({ client: null as unknown as object }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(app.client, key);
            return typeof value === "function" ? value.bind(app.client) : value;
        },
    }),
}));

const { tenantGroupTemplates } = await import("@/services/user/tenant-group-templates");
const { groupService } = await import("@/services/user/group-service");
const { seedTenantGroups } = await import("@/services/tenant/tenant-seed");

let root = "";
let base: PrismaClient;

const CLIENT = [PERMISSIONS.SOURCES.VIEW, PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.HISTORY.READ];
const TENANTS = ["acme", "globex", "initech"];

async function person(id: string, tenantId: string, groupId: string) {
    await base.user.create({ data: { id, name: id, email: `${id}@test.example`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
    await base.tenantMembership.create({ data: { userId: id, tenantId, groupId } });
}

const groupsOf = (tenantId: string) => base.group.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true, permissions: true, templateId: true } });

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-group-templates-"));
    const file = path.join(root, "groups.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
    await base.ssoProvider.deleteMany({});
    await base.tenantMembership.deleteMany({});
    await base.user.deleteMany({});
    await base.group.deleteMany({ where: { tenantId: { not: "default" } } });
    await base.tenantGroupTemplate.deleteMany({});
    await base.tenant.deleteMany({ where: { id: { not: "default" } } });
    for (const id of TENANTS) {
        await base.tenant.create({ data: { id, name: id[0].toUpperCase() + id.slice(1) } });
        await base.group.create({ data: { id: `${id}-admin`, tenantId: id, name: "Admin", fullAccess: true, permissions: "[]" } });
        await base.group.create({ data: { id: `${id}-viewer`, tenantId: id, name: "Viewer", permissions: JSON.stringify([PERMISSIONS.STORAGE.READ]) } });
    }
});

describe("a group for tenants", () => {
    it("is a real group in every tenant it reaches, with its name and permissions, and never holds the settings of the instance", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: [...CLIENT, PERMISSIONS.SETTINGS.WRITE], allTenants: false, tenantIds: ["acme", "globex"] });

        expect(saved.permissions).toEqual(expect.arrayContaining(CLIENT));
        expect(saved.permissions).not.toContain(PERMISSIONS.SETTINGS.WRITE);
        expect(saved.report.created.sort()).toEqual(["acme", "globex"]);
        for (const tenantId of ["acme", "globex"]) {
            const client = (await groupsOf(tenantId)).find((group) => group.name === "Client");
            expect(client).toEqual(expect.objectContaining({ templateId: saved.id }));
            expect(JSON.parse(client!.permissions)).toEqual(saved.permissions);
        }
        expect((await groupsOf("initech")).map((group) => group.name)).toEqual(["Admin", "Viewer"]);
    });

    it("takes no name of the group with every permission, and no name of another group for tenants", async () => {
        await expect(tenantGroupTemplates.save(null, { name: "admin", permissions: CLIENT, allTenants: true, tenantIds: [] })).rejects.toBeInstanceOf(ValidationError);
        await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });
        await expect(tenantGroupTemplates.save(null, { name: "Client", permissions: [], allTenants: false, tenantIds: ["globex"] })).rejects.toThrow(/already exists/);
    });

    it("follows a change of its name and permissions in every tenant at once", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: true, tenantIds: [] });
        const changed = await tenantGroupTemplates.save(saved.id, { name: "Customers", permissions: [PERMISSIONS.STORAGE.READ], allTenants: true, tenantIds: [] });

        expect(changed.renamedFrom).toBe("Client");
        expect(changed.areas.length).toBeGreaterThan(0);
        for (const tenantId of ["default", ...TENANTS]) {
            const group = (await groupsOf(tenantId)).find((entry) => entry.templateId === saved.id);
            expect(group?.name).toBe("Customers");
            expect(JSON.parse(group!.permissions)).toEqual([PERMISSIONS.STORAGE.READ]);
        }
    });

    it("refuses a rename onto the name of a group a tenant it reaches has", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });
        await expect(tenantGroupTemplates.save(saved.id, { name: "Viewer", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] })).rejects.toThrow(/Acme has a group named Viewer/);
    });
});

describe("a tenant that has a group of its own by the name", () => {
    beforeEach(async () => {
        await base.group.create({ data: { id: "acme-client", tenantId: "acme", name: "Client", permissions: JSON.stringify([PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DELETE]) } });
        await person("jonas", "acme", "acme-client");
    });

    it("is asked about first, with its members and what they gain and lose", async () => {
        const preview = await tenantGroupTemplates.preview(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        expect(preview.clashes).toEqual([expect.objectContaining({
            tenantId: "acme", tenantName: "Acme", groupId: "acme-client", fullAccess: false, members: [{ id: "jonas", name: "jonas" }],
            removed: [PERMISSIONS.STORAGE.DELETE],
        })]);
        expect(preview.clashes[0].added).toEqual(expect.arrayContaining([PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.HISTORY.READ]));
        await expect(tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] })).rejects.toThrow(/Take it over or leave Acme out/);
        expect(await base.tenantGroupTemplate.count()).toBe(0);
    });

    it("hands its group over to the platform, whose members keep it", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] }, { clashes: { acme: "takeOver" } });

        expect(saved.report.takenOver).toEqual(["acme"]);
        const group = await base.group.findUniqueOrThrow({ where: { id: "acme-client" } });
        expect(group.templateId).toBe(saved.id);
        expect(JSON.parse(group.permissions)).toEqual(saved.permissions);
        expect(await base.tenantMembership.findFirst({ where: { userId: "jonas" } })).toEqual(expect.objectContaining({ groupId: "acme-client" }));
    });

    it("keeps its own group when it is left out, and stays out of the tenants picked", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] }, { clashes: { acme: "leaveOut" } });

        expect(saved.report.leftOut).toEqual(["acme"]);
        expect(saved.tenantIds).toEqual(["globex"]);
        expect((await base.group.findUniqueOrThrow({ where: { id: "acme-client" } })).templateId).toBeNull();
    });
});

describe("a tenant the group leaves", () => {
    it("asks for one where people hold it, and moves them to the group picked there", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        const acmeClient = saved.report.groupIds.acme;
        await person("jonas", "acme", acmeClient);

        const preview = await tenantGroupTemplates.preview(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["globex"] });
        expect(preview.leaving).toEqual([expect.objectContaining({ tenantId: "acme", groupId: acmeClient, members: [{ id: "jonas", name: "jonas" }] })]);
        expect(preview.leaving[0].groups.map((group) => group.name)).toEqual(["Admin", "Viewer"]);
        await expect(tenantGroupTemplates.save(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["globex"] })).rejects.toThrow(/Decide what happens to Client in Acme/);

        const after = await tenantGroupTemplates.save(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["globex"] }, { leaving: { acme: { keep: false, moveTo: "acme-viewer" } } });
        expect(after.report.removed).toEqual(["acme"]);
        expect(await base.group.findUnique({ where: { id: acmeClient } })).toBeNull();
        expect(await base.tenantMembership.findFirst({ where: { userId: "jonas" } })).toEqual(expect.objectContaining({ groupId: "acme-viewer" }));
    });

    it("refuses a group of another tenant for the members", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });
        await person("jonas", "acme", saved.report.groupIds.acme);
        await expect(tenantGroupTemplates.save(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: [] }, { leaving: { acme: { keep: false, moveTo: "globex-viewer" } } }))
            .rejects.toThrow(/not one of their tenant/);
    });

    it("keeps it as a group of the tenant when asked to, which the tenant changes from then on", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });
        const acmeClient = saved.report.groupIds.acme;
        await person("jonas", "acme", acmeClient);

        await tenantGroupTemplates.save(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: [] }, { leaving: { acme: { keep: true } } });
        expect((await base.group.findUniqueOrThrow({ where: { id: acmeClient } })).templateId).toBeNull();
        await expect(runAsTenant("acme", () => groupService.update(acmeClient, { name: "Client", permissions: [] }, { platformAdmin: true }))).resolves.toEqual(expect.objectContaining({ name: "Client" }));
    });

    it("loses an empty group without a question", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        const after = await tenantGroupTemplates.save(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["globex"] });
        expect(after.report.removed).toEqual(["acme"]);
        expect((await groupsOf("acme")).map((group) => group.name)).toEqual(["Admin", "Viewer"]);
    });
});

describe("deleting a group for tenants", () => {
    it("removes it from every tenant or keeps it there, as decided by tenant", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex", "initech"] });
        await person("jonas", "acme", saved.report.groupIds.acme);
        await person("hanna", "globex", saved.report.groupIds.globex);

        await expect(tenantGroupTemplates.remove(saved.id, { acme: { keep: true } })).rejects.toThrow(/in Globex/);
        const removed = await tenantGroupTemplates.remove(saved.id, { acme: { keep: true }, globex: { keep: false, moveTo: null } });

        expect(removed.report.kept).toEqual(["acme"]);
        expect(removed.report.removed.sort()).toEqual(["globex", "initech"]);
        expect(await base.tenantGroupTemplate.count()).toBe(0);
        expect((await base.group.findUniqueOrThrow({ where: { id: saved.report.groupIds.acme } })).templateId).toBeNull();
        // Without a group Hanna is out of Globex.
        expect(await base.tenantMembership.findFirst({ where: { userId: "hanna" } })).toBeNull();
    });

    it("names the tenant where a platform admin would lose the group, unless it stays there as the tenant's own", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        await person("manu", "globex", saved.report.groupIds.globex);
        await base.user.update({ where: { id: "manu" }, data: { platformRole: "ADMIN" } });
        await person("jonas", "acme", saved.report.groupIds.acme);

        // A delete takes it from every tenant, a narrower reach from the tenants it leaves.
        expect(await tenantGroupTemplates.platformAdminLeaving(saved.id, null)).toEqual({ tenantId: "globex", tenantName: "Globex" });
        expect(await tenantGroupTemplates.platformAdminLeaving(saved.id, { allTenants: false, tenantIds: ["acme"] }, { globex: { keep: false, moveTo: "globex-viewer" } }))
            .toEqual({ tenantId: "globex", tenantName: "Globex" });
        // Kept in Globex, still reaching Globex, or only Jonas losing it: no platform admin loses anything.
        expect(await tenantGroupTemplates.platformAdminLeaving(saved.id, null, { globex: { keep: true } })).toBeNull();
        expect(await tenantGroupTemplates.platformAdminLeaving(saved.id, { allTenants: false, tenantIds: ["globex"] })).toBeNull();
        expect(await tenantGroupTemplates.platformAdminLeaving(saved.id, { allTenants: true, tenantIds: [] })).toBeNull();

        // The same for the groups one account holds, so nobody moves or ends their own membership.
        expect(await tenantGroupTemplates.memberLeaving(saved.id, "jonas", { allTenants: false, tenantIds: ["globex"] })).toEqual({ tenantId: "acme", tenantName: "Acme" });
        expect(await tenantGroupTemplates.memberLeaving(saved.id, "jonas", null, { acme: { keep: true } })).toBeNull();
        expect(await tenantGroupTemplates.memberLeaving(saved.id, "jonas", { allTenants: false, tenantIds: ["acme"] })).toBeNull();
    });
});

describe("the members a save or a delete moves or takes out of a tenant", () => {
    it("names the members of each tenant whose answer does not keep the group, and whether their membership ends", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex", "initech"] });
        await person("jonas", "acme", saved.report.groupIds.acme);
        await person("hanna", "globex", saved.report.groupIds.globex);

        // A delete leaves every tenant: Acme to no group ends Jonas's membership, Globex kept ends none, Initech holds nobody.
        expect(await tenantGroupTemplates.membersLeaving(saved.id, null, { acme: { keep: false, moveTo: null }, globex: { keep: true } }))
            .toEqual([{ tenantId: "acme", tenantName: "Acme", userIds: ["jonas"], ends: true }]);
        // A move to another group of the tenant keeps the membership, but moves its members all the same.
        expect(await tenantGroupTemplates.membersLeaving(saved.id, null, { acme: { keep: false, moveTo: "acme-viewer" }, globex: { keep: true } }))
            .toEqual([{ tenantId: "acme", tenantName: "Acme", userIds: ["jonas"], ends: false }]);
        // A save that still reaches Acme ends nothing there.
        expect(await tenantGroupTemplates.membersLeaving(saved.id, { allTenants: false, tenantIds: ["acme"] }, { globex: { keep: false, moveTo: null } }))
            .toEqual([{ tenantId: "globex", tenantName: "Globex", userIds: ["hanna"], ends: true }]);
    });
});

describe("someone added to a group whose memberships end, after the checks of the caller", () => {
    const CHANGED = "The members of this group changed meanwhile, try again.";

    it("stops a delete of a group for tenants before anyone leaves the tenant", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });
        await person("jonas", "acme", saved.report.groupIds.acme);
        const leaving = { acme: { keep: false, moveTo: null } };
        const checked = Object.fromEntries((await tenantGroupTemplates.membersLeaving(saved.id, null, leaving)).map((group) => [group.tenantId, group.userIds]));
        expect(checked).toEqual({ acme: ["jonas"] });

        // Another admin adds Lea to Client of Acme before the delete runs.
        await person("lea", "acme", saved.report.groupIds.acme);
        const refused = await tenantGroupTemplates.remove(saved.id, leaving, { platformAdmin: false, checkedEnds: checked }).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(ConflictError);
        expect((refused as Error).message).toBe(CHANGED);
        expect(await base.tenantMembership.count({ where: { groupId: saved.report.groupIds.acme } })).toBe(2);
        expect(await base.tenantGroupTemplate.count()).toBe(1);

        // Checked again with Lea, it goes through.
        const removed = await tenantGroupTemplates.remove(saved.id, leaving, { platformAdmin: false, checkedEnds: { acme: ["jonas", "lea"] } });
        expect(removed.report.removed).toEqual(["acme"]);
        expect(await base.tenantMembership.count({ where: { userId: { in: ["jonas", "lea"] } } })).toBe(0);
    });

    it("stops a save that leaves the tenant of a group nobody held at the check", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        const narrower = { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["globex"] };
        const leaving = { acme: { keep: false, moveTo: null } };
        expect(await tenantGroupTemplates.membersLeaving(saved.id, narrower, leaving)).toEqual([]);

        await person("lea", "acme", saved.report.groupIds.acme);
        await expect(tenantGroupTemplates.save(saved.id, narrower, { leaving }, { platformAdmin: false, checkedEnds: {} })).rejects.toThrow(CHANGED);
        expect(await base.tenantMembership.findFirst({ where: { userId: "lea" } })).toEqual(expect.objectContaining({ groupId: saved.report.groupIds.acme }));
        // A move to another group stops the same, since its members were not checked either.
        await expect(tenantGroupTemplates.save(saved.id, narrower, { leaving: { acme: { keep: false, moveTo: "acme-viewer" } } }, { platformAdmin: false, checkedEnds: {} }))
            .rejects.toThrow(CHANGED);
        await expect(tenantGroupTemplates.save(saved.id, narrower, { leaving: { acme: { keep: false, moveTo: "acme-viewer" } } }, { platformAdmin: false, checkedEnds: { acme: ["lea"] } }))
            .resolves.toEqual(expect.objectContaining({ report: expect.objectContaining({ removed: ["acme"] }) }));
    });

    it("stops a move of the members of a group when a platform admin joined it after the checks", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        await person("jonas", "acme", saved.report.groupIds.acme);
        const narrower = { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["globex"] };
        const leaving = { acme: { keep: false as const, moveTo: "acme-viewer" } };
        // Checked while no platform admin held it, Jonas alone moves.
        expect(await tenantGroupTemplates.platformAdminLeaving(saved.id, narrower, leaving)).toBeNull();
        const checked = Object.fromEntries((await tenantGroupTemplates.membersLeaving(saved.id, narrower, leaving)).map((group) => [group.tenantId, group.userIds]));
        expect(checked).toEqual({ acme: ["jonas"] });

        // A platform admin joins Client of Acme before the save runs.
        await person("root", "acme", saved.report.groupIds.acme);
        await base.user.update({ where: { id: "root" }, data: { platformRole: "ADMIN" } });
        await expect(tenantGroupTemplates.save(saved.id, narrower, { leaving }, { platformAdmin: false, checkedEnds: checked })).rejects.toThrow(CHANGED);
        expect(await base.tenantMembership.findFirst({ where: { userId: "root" } })).toEqual(expect.objectContaining({ groupId: saved.report.groupIds.acme }));
        await expect(tenantGroupTemplates.remove(saved.id, leaving, { platformAdmin: false, checkedEnds: checked })).rejects.toThrow(CHANGED);
        expect(await base.tenantMembership.count({ where: { groupId: saved.report.groupIds.acme } })).toBe(2);
    });

    it("stops the delete of a group of a tenant, which moves or ends the memberships of the members checked only", async () => {
        const ops = await base.group.create({ data: { tenantId: "acme", name: "Ops", permissions: JSON.stringify([PERMISSIONS.JOBS.READ]) } });
        await person("jonas", "acme", ops.id);
        const checked = await runAsTenant("acme", () => groupService.memberIds(ops.id));

        await person("lea", "acme", ops.id);
        await expect(runAsTenant("acme", () => groupService.delete(ops.id, null, { platformAdmin: false }, checked))).rejects.toThrow(CHANGED);
        await expect(runAsTenant("acme", () => groupService.delete(ops.id, "acme-viewer", { platformAdmin: false }, checked))).rejects.toBeInstanceOf(ConflictError);
        expect(await base.tenantMembership.count({ where: { groupId: ops.id } })).toBe(2);

        await expect(runAsTenant("acme", () => groupService.delete(ops.id, null, { platformAdmin: false }, ["jonas", "lea"]))).resolves.toEqual(expect.objectContaining({ moved: 2 }));
        expect(await base.group.findUnique({ where: { id: ops.id } })).toBeNull();
    });
});

describe("a tenant losing a group for tenants", () => {
    const MANAGERS = [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE];

    it("is never left without someone who manages its members, unless a platform admin changes it", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Managers", permissions: MANAGERS, allTenants: false, tenantIds: ["acme"] });
        await person("ann", "acme", saved.report.groupIds.acme);
        const nobody = /Nobody would manage the members of Acme any more/;

        // Out of the tenant, into a group that does not manage them, or the right taken from the group.
        await expect(tenantGroupTemplates.remove(saved.id, { acme: { keep: false, moveTo: null } })).rejects.toThrow(nobody);
        await expect(tenantGroupTemplates.remove(saved.id, { acme: { keep: false, moveTo: "acme-viewer" } })).rejects.toThrow(nobody);
        await expect(tenantGroupTemplates.save(saved.id, { name: "Managers", permissions: [], allTenants: false, tenantIds: [] }, { leaving: { acme: { keep: false, moveTo: null } } })).rejects.toThrow(nobody);
        await expect(tenantGroupTemplates.save(saved.id, { name: "Managers", permissions: [PERMISSIONS.USERS.READ], allTenants: false, tenantIds: ["acme"] })).rejects.toThrow(nobody);
        expect(await base.tenantMembership.findFirst({ where: { userId: "ann" } })).toEqual(expect.objectContaining({ groupId: saved.report.groupIds.acme }));

        // Into the Admin of the tenant, or with someone else who manages them there, it goes through.
        await expect(tenantGroupTemplates.save(saved.id, { name: "Managers", permissions: MANAGERS, allTenants: false, tenantIds: [] }, { leaving: { acme: { keep: false, moveTo: "acme-admin" } } }))
            .resolves.toEqual(expect.objectContaining({ report: expect.objectContaining({ removed: ["acme"] }) }));
        expect(await base.tenantMembership.findFirst({ where: { userId: "ann" } })).toEqual(expect.objectContaining({ groupId: "acme-admin" }));
    });

    it("lets a platform admin leave it without anyone who manages its members", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Managers", permissions: MANAGERS, allTenants: false, tenantIds: ["acme"] });
        await person("ann", "acme", saved.report.groupIds.acme);
        await tenantGroupTemplates.remove(saved.id, { acme: { keep: false, moveTo: null } }, { platformAdmin: true });
        expect(await base.tenantMembership.findFirst({ where: { userId: "ann" } })).toBeNull();
    });

    it("never takes over a group of a tenant whose members alone manage its members with rights that do not", async () => {
        await base.group.create({ data: { id: "acme-client", tenantId: "acme", name: "Client", permissions: JSON.stringify(MANAGERS) } });
        await person("jonas", "acme", "acme-client");
        await expect(tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] }, { clashes: { acme: "takeOver" } }))
            .rejects.toThrow(/Nobody would manage the members of Acme any more/);
    });
});

describe("a sign-in provider that adds people to a removed group", () => {
    it("is named with what changed, for the log of the platform", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        await base.ssoProvider.create({ data: { id: "sso-acme", tenantId: "acme", providerId: "acme-login", adapterId: "generic", name: "Acme login", defaultGroupId: saved.report.groupIds.acme } });
        await base.ssoProvider.create({ data: { id: "sso-globex", tenantId: "globex", providerId: "globex-login", adapterId: "generic", name: "Globex login", defaultGroupId: saved.report.groupIds.globex } });

        const removed = await tenantGroupTemplates.remove(saved.id, { acme: { keep: false, moveTo: null }, globex: { keep: false, moveTo: "globex-viewer" } });

        expect(removed.ssoProviders).toEqual(expect.arrayContaining([
            { id: "sso-acme", name: "Acme login", tenantId: "acme", before: { group: "Client", allowProvisioning: true }, after: { group: null, allowProvisioning: false } },
            { id: "sso-globex", name: "Globex login", tenantId: "globex", before: { group: "Client", allowProvisioning: true }, after: { group: "Viewer", allowProvisioning: true } },
        ]));
        expect(removed.ssoProviders).toHaveLength(2);
        expect(await base.ssoProvider.findUniqueOrThrow({ where: { id: "sso-acme" } })).toEqual(expect.objectContaining({ defaultGroupId: null, allowProvisioning: false }));
        expect(await base.ssoProvider.findUniqueOrThrow({ where: { id: "sso-globex" } })).toEqual(expect.objectContaining({ defaultGroupId: "globex-viewer", allowProvisioning: true }));
    });

    it("is named by a save that leaves its tenant too, and a group kept by the tenant changes no provider", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        await base.ssoProvider.create({ data: { id: "sso-acme", tenantId: "acme", providerId: "acme-login", adapterId: "generic", name: "Acme login", defaultGroupId: saved.report.groupIds.acme } });
        await base.ssoProvider.create({ data: { id: "sso-globex", tenantId: "globex", providerId: "globex-login", adapterId: "generic", name: "Globex login", defaultGroupId: saved.report.groupIds.globex } });

        const after = await tenantGroupTemplates.save(saved.id, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: [] }, { leaving: { acme: { keep: false, moveTo: null }, globex: { keep: true } } });

        expect(after.ssoProviders).toEqual([{ id: "sso-acme", name: "Acme login", tenantId: "acme", before: { group: "Client", allowProvisioning: true }, after: { group: null, allowProvisioning: false } }]);
        expect(await base.ssoProvider.findUniqueOrThrow({ where: { id: "sso-globex" } })).toEqual(expect.objectContaining({ defaultGroupId: saved.report.groupIds.globex }));
    });
});

describe("the own group of whoever saves a group for tenants", () => {
    it("names the tenant whose linked group the account holds when the save changes what it may do there", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme", "globex"] });
        await person("jonas", "acme", saved.report.groupIds.acme);

        expect(await tenantGroupTemplates.memberChanging(saved.id, "jonas", { permissions: [...CLIENT, PERMISSIONS.JOBS.EXECUTE], allTenants: false, tenantIds: ["acme", "globex"] }))
            .toEqual({ tenantId: "acme", tenantName: "Acme" });
        // The same rights in another order, a tenant it leaves, or someone else: nothing of the own group changes.
        expect(await tenantGroupTemplates.memberChanging(saved.id, "jonas", { permissions: [...CLIENT].reverse(), allTenants: false, tenantIds: ["acme", "globex"] })).toBeNull();
        expect(await tenantGroupTemplates.memberChanging(saved.id, "jonas", { permissions: [PERMISSIONS.STORAGE.READ], allTenants: false, tenantIds: ["globex"] })).toBeNull();
        expect(await tenantGroupTemplates.memberChanging(saved.id, "hanna", { permissions: [PERMISSIONS.STORAGE.READ], allTenants: true, tenantIds: [] })).toBeNull();
    });

    it("names a group of a tenant the account holds that a take-over would hand to the platform", async () => {
        await base.group.create({ data: { id: "acme-client", tenantId: "acme", name: "Client", permissions: JSON.stringify([PERMISSIONS.STORAGE.READ]) } });
        await person("jonas", "acme", "acme-client");

        expect(await tenantGroupTemplates.memberNamed(null, "Client", ["acme", "globex"], "jonas")).toEqual({ tenantId: "acme", tenantName: "Acme", name: "Client" });
        expect(await tenantGroupTemplates.memberNamed(null, "Client", ["globex"], "jonas")).toBeNull();

        // Once the platform holds it, it is no take-over any more.
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] }, { clashes: { acme: "takeOver" } });
        expect(await tenantGroupTemplates.memberNamed(saved.id, "Client", ["acme"], "jonas")).toBeNull();
    });
});

describe("a new tenant", () => {
    it("starts with every group for all tenants, one named Viewer in the place of its own", async () => {
        const viewer = await tenantGroupTemplates.save(null, { name: "Viewer", permissions: [PERMISSIONS.STORAGE.READ, PERMISSIONS.HISTORY.READ], allTenants: true, tenantIds: [] }, {
            clashes: Object.fromEntries(["default", ...TENANTS].map((tenantId) => [tenantId, "takeOver" as const])),
        });
        const client = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });

        await base.$transaction(async (tx) => {
            await tx.tenant.create({ data: { id: "umbrella", name: "Umbrella" } });
            await seedTenantGroups(tx as never, "umbrella");
        });

        const groups = await groupsOf("umbrella");
        expect(groups.map((group) => group.name)).toEqual(["Admin", "Viewer"]);
        expect(groups.find((group) => group.name === "Viewer")?.templateId).toBe(viewer.id);
        expect(groups.some((group) => group.templateId === client.id)).toBe(false);
    });
});

describe("a group the platform gives, inside its tenant", () => {
    it("is neither changed nor deleted there", async () => {
        const saved = await tenantGroupTemplates.save(null, { name: "Client", permissions: CLIENT, allTenants: false, tenantIds: ["acme"] });
        const id = saved.report.groupIds.acme;
        await expect(runAsTenant("acme", () => groupService.update(id, { name: "Mine", permissions: [] }, { platformAdmin: true }))).rejects.toThrow(/comes from the platform/);
        await expect(runAsTenant("acme", () => groupService.delete(id, null, { platformAdmin: true }))).rejects.toThrow(/comes from the platform/);
        const bulk = await runAsTenant("acme", () => groupService.deleteMany([id]));
        expect(bulk.failed).toEqual([expect.objectContaining({ id, error: expect.stringMatching(/comes from the platform/) })]);
    });
});
