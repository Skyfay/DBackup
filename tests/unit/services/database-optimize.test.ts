// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MB = 1024 * 1024;

const mocks = vi.hoisted(() => ({
    running: vi.fn(),
    info: vi.fn(),
    vacuum: vi.fn(),
    processQueue: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: { execution: { count: (...args: unknown[]) => mocks.running(...args) } } }));
vi.mock("@/services/system/database-service", () => ({
    getDatabaseInfo: (...args: unknown[]) => mocks.info(...args),
    vacuumDatabase: (...args: unknown[]) => mocks.vacuum(...args),
}));
vi.mock("@/lib/execution/queue-manager", () => ({ processQueue: (...args: unknown[]) => mocks.processQueue(...args) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { optimizeDatabase } = await import("@/services/system/database-optimize");
const { beginDatabaseMaintenance, endDatabaseMaintenance, endRunHold, isRunHoldActive } = await import("@/lib/server/database-maintenance");

/** A database of `total` MB with `unused` MB a VACUUM gives back. */
function database(total: number, unused: number) {
    mocks.info.mockResolvedValue({ totalBytes: total * MB, reclaimableBytes: unused * MB });
}

describe("the system task Optimize the database", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        endRunHold();
        endDatabaseMaintenance();
        mocks.running.mockResolvedValue(0);
        mocks.vacuum.mockResolvedValue({ beforeBytes: 100 * MB, afterBytes: 70 * MB, durationMs: 800 });
        mocks.processQueue.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("leaves the database alone while less than a fifth of it is unused", async () => {
        database(100, 19);

        expect(await optimizeDatabase()).toEqual({ status: "skipped", reclaimableBytes: 19 * MB });
        expect(mocks.vacuum).not.toHaveBeenCalled();
        expect(mocks.running).not.toHaveBeenCalled();
    });

    it("leaves a small database alone however much of it is unused", async () => {
        database(2, 0.9);

        expect(await optimizeDatabase()).toMatchObject({ status: "skipped" });
        expect(mocks.vacuum).not.toHaveBeenCalled();
    });

    it("rebuilds it right away when nothing runs, then lets the queue go on", async () => {
        database(100, 30);

        expect(await optimizeDatabase()).toEqual({ status: "done", beforeBytes: 100 * MB, afterBytes: 70 * MB, durationMs: 800 });
        expect(isRunHoldActive()).toBe(false);
        await vi.waitFor(() => expect(mocks.processQueue).toHaveBeenCalled());
    });

    it("holds new runs back and waits for the running ones to end", async () => {
        database(100, 30);
        mocks.running.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValue(0);

        const optimizing = optimizeDatabase();
        await vi.advanceTimersByTimeAsync(0);
        expect(isRunHoldActive()).toBe(true);
        expect(mocks.vacuum).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(await optimizing).toMatchObject({ status: "done" });
        expect(mocks.vacuum).toHaveBeenCalledTimes(1);
        expect(isRunHoldActive()).toBe(false);
    });

    it("gives up after an hour and lets the runs it held back start", async () => {
        database(100, 30);
        mocks.running.mockResolvedValue(1);

        const optimizing = optimizeDatabase();
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 15_000);

        expect(await optimizing).toEqual({ status: "waited", running: 1 });
        expect(mocks.vacuum).not.toHaveBeenCalled();
        expect(isRunHoldActive()).toBe(false);
        await vi.waitFor(() => expect(mocks.processQueue).toHaveBeenCalled());
    });

    it("waits while Optimize under Database or a download holds the database", async () => {
        database(100, 30);
        beginDatabaseMaintenance();

        const optimizing = optimizeDatabase();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(mocks.vacuum).not.toHaveBeenCalled();

        endDatabaseMaintenance();
        await vi.advanceTimersByTimeAsync(15_000);

        expect(await optimizing).toMatchObject({ status: "done" });
    });

    it("lets the held runs start also when the VACUUM fails", async () => {
        database(100, 30);
        mocks.vacuum.mockRejectedValue(new Error("Not enough free disk space"));

        await expect(optimizeDatabase()).rejects.toThrow("Not enough free disk space");
        expect(isRunHoldActive()).toBe(false);
        await vi.waitFor(() => expect(mocks.processQueue).toHaveBeenCalled());
    });
});
