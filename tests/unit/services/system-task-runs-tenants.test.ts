// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { explicitScope, runAsSystem } from "@/lib/tenant/context";
import { AVAILABLE_PERMISSIONS, PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } from "@/lib/auth/permissions";
import type { IntegrityCheckResult, IntegrityProgressCallbacks } from "@/services/backup/integrity-service";

interface FakeRun {
    id: string;
    tenantId: string;
    start: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    logEntry: ReturnType<typeof vi.fn>;
    setStage: ReturnType<typeof vi.fn>;
    setExtra: ReturnType<typeof vi.fn>;
    updateStageProgress: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
    runs: [] as FakeRun[],
    events: [] as string[],
    tenantsToCheck: vi.fn(),
    check: vi.fn(),
    notify: vi.fn(),
    notifyTenants: vi.fn(),
}));

/** The tenant the code that runs now acts for, as the run sees it. */
const scopeTenant = () => {
    const scope = explicitScope();
    return scope?.kind === "tenant" ? scope.tenantId : scope?.kind ?? "none";
};

vi.mock("@/lib/core/registry", () => ({ registry: { get: vi.fn() } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn() }));
vi.mock("@/lib/transport/adapter-invoke", () => ({ runAdapterTest: vi.fn() }));
vi.mock("@/services/system/update-service", () => ({ updateService: { checkForUpdates: vi.fn() } }));
vi.mock("@/services/system/db-version-service", () => ({ recordVersionIfChanged: vi.fn() }));
vi.mock("@/services/databases/database-list-service", () => ({ databaseListService: { readSources: vi.fn() } }));
vi.mock("@/services/notifications/system-notification-service", () => ({
    notify: (...args: unknown[]) => mocks.notify(...args),
    getNotificationConfig: vi.fn(),
}));
vi.mock("@/services/notifications/tenant-integrity", () => ({ notifyTenantsOfIntegrity: (...args: unknown[]) => mocks.notifyTenants(...args) }));
vi.mock("@/services/backup/integrity-service", () => ({
    integrityService: {
        tenantsToCheck: () => mocks.tenantsToCheck(),
        runFullIntegrityCheck: (callbacks: IntegrityProgressCallbacks) => mocks.check(callbacks),
    },
}));
vi.mock("@/lib/runner/system-task-runner", () => ({
    SystemTaskRunner: {
        // Records the tenant each run is made in, which is the tenant its Execution is stamped with.
        create: vi.fn(async () => {
            const tenantId = scopeTenant();
            mocks.events.push(`create ${tenantId}`);
            const run: FakeRun = {
                id: `run-${tenantId}`,
                tenantId,
                start: vi.fn(async () => undefined),
                finish: vi.fn(async () => void mocks.events.push(`finish ${tenantId}`)),
                logEntry: vi.fn(),
                setStage: vi.fn(),
                setExtra: vi.fn(),
                updateStageProgress: vi.fn(),
            };
            mocks.runs.push(run);
            return run;
        }),
    },
}));

const { startIntegrityCheck, syncPermissions } = await import("@/services/system/system-task-runs");

const result = (passed: number, failed: number): IntegrityCheckResult => ({
    totalFiles: passed + failed, verified: passed + failed, passed, failed, skipped: 0, scanFailed: 0,
    errors: failed > 0 ? [{ file: "a.tar", destination: "NAS", expected: "x", actual: "y" }] : [],
});

/** A check that finds one copy at a destination of the tenant it runs in, failed in acme. */
function checkOneCopyPerTenant() {
    mocks.check.mockImplementation(async (callbacks: IntegrityProgressCallbacks) => {
        const tenantId = scopeTenant();
        const failed = tenantId === "acme";
        callbacks.onCopy?.({ index: 0, destinationId: `${tenantId}-nas`, file: `${tenantId}/db.tar`, size: 1, state: failed ? "failed" : "passed" });
        return result(failed ? 0 : 1, failed ? 1 : 0);
    });
}

async function runCheck() {
    const onDone = vi.fn(async () => undefined);
    const started = await runAsSystem(() => startIntegrityCheck("Scheduler", "Scheduler", onDone));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    return { started, onDone };
}

describe("the integrity check of every tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runs = [];
        mocks.events = [];
        mocks.tenantsToCheck.mockResolvedValue(["acme", "default", "zeta"]);
        mocks.notify.mockResolvedValue(undefined);
        mocks.notifyTenants.mockResolvedValue(undefined);
        checkOneCopyPerTenant();
    });

    it("records the copies of each tenant in a run of that tenant, so no History names the backups of another", async () => {
        await runCheck();

        expect(mocks.runs.map((run) => run.tenantId)).toEqual(["default", "acme", "zeta"]);
        expect(mocks.check).toHaveBeenCalledTimes(3);
        for (const run of mocks.runs) {
            const copies = run.setExtra.mock.calls.flatMap(([extra]) => (extra as { copies?: { destinationId: string }[] }).copies ?? []);
            expect(copies.map((copy) => copy.destinationId)).toEqual([`${run.tenantId}-nas`]);
        }
        expect(mocks.runs[0].logEntry).toHaveBeenCalledWith("The copies of 2 other tenants are checked in runs of their own");
        expect(mocks.runs[1].finish).toHaveBeenCalledWith("Partial");
        expect(mocks.runs[2].finish).toHaveBeenCalledWith("Success");
    });

    it("hands back the run of the home tenant at once and makes the others only when their turn comes", async () => {
        const { started, onDone } = await runCheck();

        expect(started).toEqual({ executionId: "run-default", pending: true });
        // A run made ahead would wait as Pending, which the queue takes for a backup to start.
        expect(mocks.events).toEqual(["create default", "finish default", "create acme", "finish acme", "create zeta", "finish zeta"]);
        expect(onDone).toHaveBeenCalledWith({ ok: false, summary: "1 of 3 failed", executionId: "run-default" });
    });

    it("tells the platform about every failed copy and each tenant about its own", async () => {
        await runCheck();

        expect(mocks.notify).toHaveBeenCalledTimes(1);
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalFiles: 3, failed: 1, passed: 2 }) }), { executionId: "run-default" });
        expect(mocks.notifyTenants).toHaveBeenCalledWith(
            [expect.objectContaining({ destinationId: "default-nas" }), expect.objectContaining({ destinationId: "acme-nas" }), expect.objectContaining({ destinationId: "zeta-nas" })],
            "Scheduler",
        );
    });

    it("fails only the run of a tenant whose check breaks, and goes on with the others", async () => {
        mocks.check.mockImplementation(async () => {
            if (scopeTenant() === "acme") throw new Error("acme-secret-host unreachable");
            return result(2, 0);
        });

        const { onDone } = await runCheck();

        expect(mocks.runs.map((run) => [run.tenantId, run.finish.mock.calls[0][0]])).toEqual([["default", "Success"], ["acme", "Failed"], ["zeta", "Success"]]);
        // The Settings page names no tenant and none of its hosts.
        expect(onDone).toHaveBeenCalledWith({ ok: false, summary: "Failed in 1 tenant", executionId: "run-default" });
    });

    it("checks the home tenant alone as before when no other tenant has anything to check", async () => {
        mocks.tenantsToCheck.mockResolvedValue([]);

        const { onDone } = await runCheck();

        expect(mocks.runs.map((run) => run.tenantId)).toEqual(["default"]);
        expect(mocks.runs[0].logEntry).not.toHaveBeenCalledWith(expect.stringContaining("other tenant"));
        expect(onDone).toHaveBeenCalledWith({ summary: "1 backup passed", executionId: "run-default" });
    });
});

describe("syncing the permissions of the groups with every permission", () => {
    beforeEach(() => vi.clearAllMocks());

    it("stores every permission of a tenant and no right of the platform", async () => {
        prismaMock.group.updateMany.mockResolvedValue({ count: 3 });

        expect(await syncPermissions()).toEqual({ summary: `${AVAILABLE_PERMISSIONS.length} permissions` });

        const stored = JSON.parse((prismaMock.group.updateMany.mock.calls[0][0] as { data: { permissions: string } }).data.permissions) as string[];
        expect(stored).toEqual(AVAILABLE_PERMISSIONS.map((permission) => permission.id));
        for (const platform of [...PLATFORM_ONLY_PERMISSIONS.map((permission) => permission.id), PERMISSIONS.PLATFORM.SIGN_IN_WRITE]) {
            expect(stored).not.toContain(platform);
        }
    });
});
