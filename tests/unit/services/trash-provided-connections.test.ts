// @vitest-environment node
/**
 * Recently deleted for a job of a customer that writes to a destination and tells a channel another
 * tenant shares with it, against a real SQLite database migrated with the migrations of this version.
 * The shared connections belong to the tenant that shares them, so the scope of the customer never
 * finds them, and a restore still brings the links back while they are shared.
 */
import { execFileSync } from "child_process";
import { copyFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/prisma-tx";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { openCopy } = await import("@/services/config/database-copy");
const { keepInTrash } = await import("@/services/trash/trash-snapshot");
const { restoreSnapshot } = await import("@/services/trash/trash-restore");
const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");
const { runAsSystem, runAsTenant } = await import("@/lib/tenant/context");

const openScoped = (file: string) => openCopy(file).$extends(tenantScopeExtension(async () => null));

let root = "";
let template = "";
let db: ReturnType<typeof openScoped>;

const asTx = (tx: unknown) => tx as Tx;

/** Acme Hosting shares a NAS and a mail channel with its customer Globex. */
const acme = <T>(fn: () => Promise<T>) => runAsTenant("acme", fn);
const globex = <T>(fn: () => Promise<T>) => runAsTenant("globex", fn);

async function seed() {
    await db.tenant.create({ data: { id: "acme", name: "Acme Hosting", sharesWithCustomers: true } });
    await db.tenant.create({ data: { id: "globex", name: "Globex" } });
    await acme(async () => {
        await db.adapterConfig.create({ data: { id: "acme-nas", name: "Acme NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
        await db.adapterConfig.create({ data: { id: "acme-mail", name: "Acme mail", type: "notification", adapterId: "email", config: "{}" } });
        for (const id of ["acme-nas", "acme-mail"]) {
            await db.connectionShare.create({ data: { id, tenantId: "acme", tenants: { create: [{ tenantId: "globex" }] } } });
        }
    });
    await globex(async () => {
        await db.encryptionProfile.create({ data: { id: "globex-key", name: "Globex key", secretKey: "not-a-real-secret" } });
        await db.adapterConfig.create({ data: { id: "globex-db", name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
        await db.job.create({
            data: {
                id: "globex-job",
                name: "Shop nightly",
                schedule: "0 3 * * *",
                sourceId: "globex-db",
                encryptionProfileId: "globex-key",
                notifications: { connect: [{ id: "acme-mail" }] },
                destinations: { create: [{ id: "dest-1", configId: "acme-nas" }] },
            },
        });
    });
}

/** Deletes the job of Globex into Recently deleted, like the delete of the job service. */
const trashJob = () => globex(() => db.$transaction(async (tx) => {
    const trashId = await keepInTrash(asTx(tx), "job", "globex-job");
    await tx.job.delete({ where: { id: "globex-job" } });
    return trashId;
}));

const restoreJob = (trashId: string) => globex(async () => {
    const entry = await db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } });
    return db.$transaction((tx) => restoreSnapshot(asTx(tx), "job", JSON.parse(entry.data)));
});

const restoredJob = () => globex(() => db.job.findUniqueOrThrow({ where: { id: "globex-job" }, include: { destinations: true, notifications: { select: { id: true } } } }));

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-trash-provided-"));
    template = path.join(root, "template.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${template}` },
        stdio: "pipe",
    });
}, 120_000);

beforeEach(async () => {
    const file = path.join(root, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    copyFileSync(template, file);
    db = openScoped(file);
    await seed();
});

afterEach(async () => {
    await db.$disconnect();
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("a deleted job of a customer on what another tenant shares with it", () => {
    it("comes back with the shared destination and the shared channel, which the customer's scope does not find", async () => {
        const trashId = await trashJob();
        expect(await globex(() => db.adapterConfig.count({ where: { id: { in: ["acme-nas", "acme-mail"] } } }))).toBe(0);

        await expect(restoreJob(trashId)).resolves.toEqual({ name: "Shop nightly", notes: [] });

        const job = await restoredJob();
        expect(job.destinations).toMatchObject([{ id: "dest-1", configId: "acme-nas" }]);
        expect(job.notifications).toEqual([{ id: "acme-mail" }]);
    });

    it("leaves out a shared destination that takes only encrypted backups once the job's key is gone, and says why", async () => {
        await acme(() => db.connectionShare.update({ where: { id: "acme-nas" }, data: { encryptedOnly: true } }));
        const trashId = await trashJob();
        await globex(() => db.encryptionProfile.delete({ where: { id: "globex-key" } }));

        const restored = await restoreJob(trashId);

        expect(restored.notes).toEqual([
            "It is paused, its encryption key is gone and it would back up unencrypted.",
            "1 destination is left out, it takes only encrypted backups and the job has no key.",
        ]);
        const job = await restoredJob();
        expect(job).toMatchObject({ enabled: false, encryptionProfileId: null });
        expect(job.destinations).toEqual([]);
        expect(job.notifications).toEqual([{ id: "acme-mail" }]);
    });

    it("keeps a shared destination that takes only encrypted backups while the job still has its key", async () => {
        await acme(() => db.connectionShare.update({ where: { id: "acme-nas" }, data: { encryptedOnly: true } }));
        const trashId = await trashJob();

        await expect(restoreJob(trashId)).resolves.toEqual({ name: "Shop nightly", notes: [] });
        expect((await restoredJob()).destinations).toMatchObject([{ configId: "acme-nas" }]);
    });

    it("drops the destination and the channel once they are no longer shared with the customer", async () => {
        const trashId = await trashJob();
        await acme(() => db.connectionShare.deleteMany({ where: { id: { in: ["acme-nas", "acme-mail"] } } }));

        const restored = await restoreJob(trashId);

        expect(restored.notes).toEqual(["1 destination is left out, its connection is gone."]);
        const job = await restoredJob();
        expect(job.destinations).toEqual([]);
        expect(job.notifications).toEqual([]);
    });

    it("drops them once the tenant that shares them stops sharing with customers", async () => {
        const trashId = await trashJob();
        await runAsSystem(() => db.tenant.update({ where: { id: "acme" }, data: { sharesWithCustomers: false } }));

        const restored = await restoreJob(trashId);

        expect(restored.notes).toEqual(["1 destination is left out, its connection is gone."]);
        expect((await restoredJob()).notifications).toEqual([]);
    });
});
