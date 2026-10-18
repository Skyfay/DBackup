/**
 * The settings of a destination another tenant shares are that tenant's: its saved logins, its
 * options and why they could not be used. A customer whose run or listing meets such a failure reads
 * `SHARED_STORAGE_FAILURE`, never the message, and its run refuses the upload there instead of failing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterConfig } from "@prisma/client";
import { SHARED_STORAGE_FAILURE } from "@/lib/tenant/storage-view";
import type { RunnerContext } from "@/lib/runner/types";

const mocks = vi.hoisted(() => ({
    resolve: vi.fn(),
    access: vi.fn(),
    job: vi.fn(),
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({
    registry: {
        get: (id: string) => (id === "mysql" ? { type: "database", dump: vi.fn() } : { id, type: "storage", upload: vi.fn(), list: vi.fn() }),
        register: vi.fn(),
    },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: (...args: unknown[]) => mocks.resolve(...args) }));
vi.mock("@/lib/prisma", () => ({
    default: {
        job: { findUnique: (...args: unknown[]) => mocks.job(...args) },
        execution: { create: vi.fn() },
        retentionPolicy: { findUnique: vi.fn(), findFirst: vi.fn() },
        connectionShare: { count: vi.fn().mockResolvedValue(0) },
    },
}));
vi.mock("@/services/sharing/destination-access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/sharing/destination-access")>()),
    destinationAccess: (...args: unknown[]) => mocks.access(...args),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { openRow } = await import("@/services/sharing/destination-access");
const { stepInitialize } = await import("@/lib/runner/steps/01-initialize");

/** What the resolver says of a login of the tenant that shares the destination. */
const PROVIDER_ERROR = "The saved login MSP S3 admin (AKIA-MSP-7) of Skyfay Hosting was deleted.";

const ROW = { id: "msp-s3", name: "MSP S3", type: "storage", adapterId: "s3-generic", config: "{}", tenantId: "msp" } as unknown as AdapterConfig;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockRejectedValue(new Error(PROVIDER_ERROR));
});

describe("opening a destination another tenant shares", () => {
    it("tells the customer nothing of why its settings could not be used", async () => {
        await expect(openRow(ROW, { kind: "customer", tenantId: "acme" })).rejects.toThrow(SHARED_STORAGE_FAILURE);
    });

    it("tells the tenant it belongs to the whole message", async () => {
        await expect(openRow(ROW, { kind: "provider" })).rejects.toThrow(PROVIDER_ERROR);
        await expect(openRow(ROW, { kind: "own" })).rejects.toThrow(PROVIDER_ERROR);
    });
});

describe("a run of a customer that writes to a destination another tenant shares", () => {
    const ctx = () => ({
        jobId: "job-1", logs: [], log: vi.fn(), updateProgress: vi.fn(), setStage: vi.fn(), updateDetail: vi.fn(), updateStageProgress: vi.fn(),
        destinations: [], status: "Running", startedAt: new Date(), execution: { id: "run-1" },
    }) as unknown as RunnerContext;

    beforeEach(() => {
        mocks.job.mockResolvedValue({
            id: "job-1", name: "Nightly", tenantId: "acme",
            source: { id: "src-1", adapterId: "mysql", config: "{}", name: "Shop", type: "database", tenantId: "acme" },
            destinations: [{ id: "d-1", configId: "msp-s3", priority: 0, retention: "{}", retentionPolicyId: null, config: ROW }],
            sources: [], notifications: [], notificationTemplates: [],
        });
    });

    it("refuses the upload there with the words of a storage that does not answer, and names nothing of its settings", async () => {
        mocks.access.mockResolvedValue({ mode: { kind: "customer", tenantId: "acme" }, provided: { encryptedOnly: false } });
        const run = ctx();

        await stepInitialize(run);

        expect(run.destinations[0]).toMatchObject({ configId: "msp-s3", refusal: SHARED_STORAGE_FAILURE, customer: "acme", config: {} });
        expect(JSON.stringify(vi.mocked(run.log).mock.calls)).not.toContain("AKIA-MSP-7");
    });

    it("still fails a run of the tenant the destination belongs to with the whole message", async () => {
        mocks.access.mockResolvedValue({ mode: { kind: "own" }, provided: null });
        mocks.job.mockResolvedValue({ ...(await mocks.job()), tenantId: "msp" });

        await expect(stepInitialize(ctx())).rejects.toThrow(PROVIDER_ERROR);
    });
});
