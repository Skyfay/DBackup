// @vitest-environment node
/**
 * A customer's backups can sit on a destination another tenant shares with it, so a copy of the
 * customer carries the id of a destination of the provider. Who hears about a failed copy follows
 * the tenant whose run of the integrity check went through it, never the tenant of the destination.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { explicitScope, runAsSystem } from "@/lib/tenant/context";
import type { IntegrityCheckResult, IntegrityProgressCallbacks } from "@/services/backup/integrity-service";

const mocks = vi.hoisted(() => ({
    tenantsToCheck: vi.fn(),
    check: vi.fn(),
    notify: vi.fn(),
}));

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
vi.mock("@/services/backup/integrity-service", () => ({
    integrityService: {
        tenantsToCheck: () => mocks.tenantsToCheck(),
        runFullIntegrityCheck: (callbacks: IntegrityProgressCallbacks) => mocks.check(callbacks),
    },
}));
vi.mock("@/lib/runner/system-task-runner", () => ({
    SystemTaskRunner: {
        create: vi.fn(async () => ({
            id: `run-${scopeTenant()}`,
            start: vi.fn(async () => undefined),
            finish: vi.fn(async () => undefined),
            logEntry: vi.fn(),
            setStage: vi.fn(),
            setExtra: vi.fn(),
            updateStageProgress: vi.fn(),
        })),
    },
}));

const { startIntegrityCheck } = await import("@/services/system/system-task-runs");

/** The destinations by id: the MSP shares its NAS, acme has a disk of its own. */
const DESTINATIONS = [
    { id: "msp-nas", name: "MSP NAS", tenantId: "msp" },
    { id: "home-s3", name: "Platform S3", tenantId: "default" },
    { id: "acme-disk", name: "Acme disk", tenantId: "acme" },
];

/** Each tenant's run finds the copies given for it, as the check of that tenant would. */
function copiesPerTenant(copies: Record<string, { destinationId: string; file: string; failed: boolean }[]>) {
    mocks.check.mockImplementation(async (callbacks: IntegrityProgressCallbacks) => {
        const own = copies[scopeTenant()] ?? [];
        own.forEach((copy, index) => callbacks.onCopy?.({
            index, destinationId: copy.destinationId, file: copy.file, size: 1, state: copy.failed ? "failed" : "passed",
            ...(copy.failed ? { expected: "aaa", actual: "bbb" } : {}),
        }));
        const failed = own.filter((copy) => copy.failed).length;
        const result: IntegrityCheckResult = {
            totalFiles: own.length, verified: own.length, passed: own.length - failed, failed, skipped: 0, scanFailed: 0,
            errors: own.filter((copy) => copy.failed).map((copy) => ({ file: copy.file, destination: copy.destinationId, expected: "aaa", actual: "bbb" })),
        };
        return result;
    });
}

async function runCheck() {
    const onDone = vi.fn(async () => undefined);
    await runAsSystem(() => startIntegrityCheck("Scheduler", "Scheduler", onDone));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
}

/** The notices sent to the channels of a tenant, not to the platform. */
const tenantNotices = () => mocks.notify.mock.calls.filter(([, options]) => (options as { platform?: boolean } | undefined)?.platform === false);

describe("who hears about a failed copy of the integrity check", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.notify.mockResolvedValue(undefined);
        prismaMock.adapterConfig.findMany.mockImplementation((async ({ where }: { where: { id: { in: string[] } } }) =>
            DESTINATIONS.filter((destination) => where.id.in.includes(destination.id))) as never);
        prismaMock.tenant.findMany.mockResolvedValue([{ id: "acme", name: "Acme" }, { id: "msp", name: "MSP" }] as never);
    });

    it("tells the customer about its copy on a destination the MSP shares, and never the MSP", async () => {
        mocks.tenantsToCheck.mockResolvedValue(["default", "msp", "acme"]);
        copiesPerTenant({
            msp: [{ destinationId: "msp-nas", file: "nightly/msp-db.tar", failed: false }],
            acme: [{ destinationId: "msp-nas", file: "nightly/acme-shop.tar", failed: true }],
        });

        await runCheck();

        const notices = tenantNotices();
        expect(notices).toHaveLength(1);
        const [event, options] = notices[0] as [{ data: { totalFiles: number; failed: number; errors: { file: string; destination: string }[] } }, { tenantId: string }];
        expect(options).toEqual({ tenantId: "acme", platform: false });
        expect(event.data).toEqual(expect.objectContaining({ totalFiles: 1, failed: 1 }));
        // The name the customer sees for the destination, read across tenants.
        expect(event.data.errors).toEqual([{ file: "acme-shop.tar", destination: "MSP NAS", expected: "aaa", actual: "bbb" }]);
        // The platform hears that a copy of Acme failed, never which one.
        const platform = mocks.notify.mock.calls.find(([, options]) => (options as { platform?: boolean }).platform !== false)!;
        expect(platform[0].data).toEqual(expect.objectContaining({ failed: 1, errors: [], tenants: [{ tenant: "Acme", failed: 1, totalFiles: 1 }] }));
        expect(JSON.stringify(platform[0].data)).not.toContain("acme-shop");
    });

    it("tells the customer about its copy on a destination of the home tenant", async () => {
        mocks.tenantsToCheck.mockResolvedValue(["default", "acme"]);
        copiesPerTenant({
            default: [{ destinationId: "home-s3", file: "platform.tar", failed: false }],
            acme: [{ destinationId: "home-s3", file: "acme/shop.tar", failed: true }, { destinationId: "acme-disk", file: "crm.tar", failed: false }],
        });

        await runCheck();

        const notices = tenantNotices();
        expect(notices.map(([, options]) => (options as { tenantId: string }).tenantId)).toEqual(["acme"]);
        expect((notices[0][0] as { data: { totalFiles: number; passed: number } }).data).toEqual(expect.objectContaining({ totalFiles: 2, passed: 1 }));
    });

    it("leaves a tenant whose copies all passed and the home tenant to the notice of the platform", async () => {
        mocks.tenantsToCheck.mockResolvedValue(["default", "msp", "acme"]);
        copiesPerTenant({
            default: [{ destinationId: "home-s3", file: "platform.tar", failed: true }],
            msp: [{ destinationId: "msp-nas", file: "msp.tar", failed: false }],
            acme: [{ destinationId: "msp-nas", file: "acme.tar", failed: false }],
        });

        await runCheck();

        expect(tenantNotices()).toEqual([]);
        // The platform still hears about every failed copy.
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failed: 1 }) }), { executionId: "run-default" });
    });
});
