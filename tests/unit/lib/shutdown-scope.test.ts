// @vitest-environment node
/**
 * A signal reaches the shutdown outside any scope, also when its listeners were registered inside
 * `runAsSystem(startServer)`. The queries of the executions belong to every tenant, so without a
 * scope of its own they threw `TenantScopeError` under `next start` and the shutdown never waited
 * for the running runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explicitScope, runAsSystem, type TenantScope } from "@/lib/tenant/context";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const scopes = vi.hoisted(() => ({ seen: [] as (TenantScope | undefined)[] }));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: {
            count: vi.fn(async () => {
                scopes.seen.push(explicitScope());
                return 0;
            }),
            updateMany: vi.fn(async () => ({ count: 0 })),
        },
        $disconnect: vi.fn(async () => undefined),
    },
}));

vi.mock("@/lib/server/scheduler", () => ({ scheduler: { stopAll: vi.fn() } }));

describe("the shutdown on a signal", () => {
    let listeners: Record<string, () => void>;
    let exit: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        scopes.seen = [];
        listeners = {};
        vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
            listeners[event] = listener;
            return process;
        }) as never);
        exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("counts the runs of every tenant in the system scope, whatever scope the listeners were registered in", async () => {
        const { registerShutdownHandlers } = await import("@/lib/server/shutdown");
        runAsSystem(() => registerShutdownHandlers());

        // The signal comes from outside, with no scope around it.
        expect(explicitScope()).toBeUndefined();
        listeners.SIGTERM();
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

        // Once while it waits for the running runs, once for the pending ones it cancels.
        expect(scopes.seen).toEqual([{ kind: "system" }, { kind: "system" }]);
    });
});
