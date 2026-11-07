// @vitest-environment node
/**
 * The run a customer sees of a backup they started of a database on a shared server, against a real
 * SQLite database migrated with the migrations of this version: it waits, follows the real run of the
 * server's tenant through its steps, ends with it, names the customer's database alone, and Cancel in
 * the customer's History stops the real run in the other tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
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

const { createCustomerBackupRun, customerBackupFollower, dropCustomerBackupRun } = await import("@/services/tenant/shared-backup-runs");
const { getRunDetail } = await import("@/services/history/run-detail-service");
const { cancelRun } = await import("@/services/history/run-cancel");

let root = "";
let base: PrismaClient;

/** Everything of the server's run the customer must never read. */
const HIDDEN = ["Nightly", "other_db", "Retention", "Notifications", "MSP NAS", "Processing", "Verifying"];

const RUN = { tenantId: "acme", databaseName: "shop", serverName: "Shared MySQL", adapterId: "mysql", providerName: "Skyfay Hosting", person: "Sara" };

/** The real run of the server's tenant, waiting in the queue. */
async function leader(id: string) {
    await base.execution.create({ data: { id, tenantId: "default", type: "Backup", status: "Pending", logs: "[]", metadata: JSON.stringify({ progress: 0, stage: "Queued", onlyDatabases: ["shop"] }), triggerType: "Manual", triggerLabel: "Acme · Sara" } });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shared-backup-runs-"));
    const file = path.join(root, "runs.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));
    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

async function messagesOf(id: string): Promise<string[]> {
    const row = await base.execution.findUniqueOrThrow({ where: { id } });
    return (JSON.parse(row.logs) as { message: string }[]).map((entry) => entry.message);
}

describe("the customer's run of a backup they started", () => {
    it("waits in the customer's tenant and names the database and the server", async () => {
        await leader("leader-wait");
        const id = await createCustomerBackupRun({ ...RUN, leaderId: "leader-wait" });
        const row = await base.execution.findUniqueOrThrow({ where: { id } });
        expect(row).toEqual(expect.objectContaining({ tenantId: "acme", type: "Backup", status: "Pending", jobId: null, triggerType: "Manual", triggerLabel: "Sara" }));
        expect(await messagesOf(id)).toEqual(["Backup of shop on Shared MySQL queued."]);

        const page = await runAsTenant("acme", () => getRunDetail(id));
        expect(page).toEqual(expect.objectContaining({ name: "Backup of shop", sub: "Backup · on Shared MySQL", status: "Pending", adapterId: "mysql", usualMs: null }));
    });

    it("follows the real run through its steps and ends with it, with the size of its dump", async () => {
        await leader("leader-ok");
        const id = await createCustomerBackupRun({ ...RUN, leaderId: "leader-ok" });
        const follower = await customerBackupFollower("leader-ok");
        expect(follower).not.toBeNull();

        follower!.start();
        for (const stage of ["Initializing", "Dumping Databases", "Processing", "Uploading", "Verifying", "Applying Retention", "Completed"]) follower!.stage(stage);
        // Some copies of the provider failed: the backup is there for the customer.
        await follower!.end({
            status: "Partial",
            dumps: [{ name: "shop", state: "done", bytes: 5632 }, { name: "other_db", state: "done", bytes: 99 }],
        });

        const row = await base.execution.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe("Success");
        expect(row.endedAt).not.toBeNull();
        expect(Number(row.size)).toBe(5632);
        const messages = await messagesOf(id);
        expect(messages).toEqual(expect.arrayContaining([
            "Backup of shop started.",
            "Dumping shop...",
            "Storing the backup of shop...",
            "Backup of shop completed, its dump holds 5.5 KB.",
        ]));
        for (const hidden of HIDDEN) expect(JSON.stringify(messages), `the run names ${hidden}`).not.toContain(hidden);

        const page = await runAsTenant("acme", () => getRunDetail(id));
        expect(page?.status).toBe("Success");
        expect(page?.steps.map((step) => step.name)).toEqual(["Initializing", "Dumping Databases", "Uploading"]);
    });

    it("says the backup failed in neutral words and who sees why", async () => {
        await leader("leader-failed");
        const id = await createCustomerBackupRun({ ...RUN, leaderId: "leader-failed" });
        const follower = await customerBackupFollower("leader-failed");
        follower!.start();
        follower!.stage("Dumping Databases");
        await follower!.end({ status: "Failed", dumps: [{ name: "shop", state: "failed", bytes: null }] });

        const row = await base.execution.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe("Failed");
        expect(row.size).toBeNull();
        expect(await messagesOf(id)).toEqual(expect.arrayContaining(["The backup of shop failed.", "Skyfay Hosting sees the full run in its History."]));
        const page = await runAsTenant("acme", () => getRunDetail(id));
        expect(page?.steps.find((step) => step.name === "Dumping Databases")?.state).toBe("failed");
    });

    it("finds no follower for a run without one", async () => {
        await leader("leader-alone");
        expect(await customerBackupFollower("leader-alone")).toBeNull();
    });

    it("stops the real run in the tenant of the server with Cancel in the customer's History", async () => {
        await leader("leader-cancel");
        const id = await createCustomerBackupRun({ ...RUN, leaderId: "leader-cancel" });

        const result = await runAsTenant("acme", () => cancelRun(id));
        expect(result.run.id).toBe(id);
        expect((await base.execution.findUniqueOrThrow({ where: { id: "leader-cancel" } })).status).toBe("Cancelled");
        expect((await base.execution.findUniqueOrThrow({ where: { id } })).status).toBe("Cancelled");
        expect(await messagesOf(id)).toContain("The run was cancelled.");
    });

    it("is dropped again when the real run could not be queued", async () => {
        const id = await createCustomerBackupRun({ ...RUN, leaderId: "never-queued" });
        await dropCustomerBackupRun(id);
        expect(await base.execution.findUnique({ where: { id } })).toBeNull();
    });
});
