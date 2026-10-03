import { describe, expect, it } from "vitest";
import { planQueue, type QueueItem } from "@/lib/core/queue-plan";

const MIN = 60_000;
const now = Date.parse("2026-10-02T03:12:00Z");
const at = (time: string) => Date.parse(`2026-10-02T${time}:00Z`);

describe("when the queue starts each run", () => {
    it("lets a run that is due while another runs wait until a slot frees up, and names the job ahead", () => {
        const items: QueueItem[] = [
            { key: "files", jobId: "files", due: at("06:00"), durationMs: 10 * MIN },
            { key: "cache", jobId: "cache", due: at("06:01"), durationMs: 3_000 },
        ];
        const plan = planQueue(items, 1, now);

        expect(plan.get("files")).toMatchObject({ start: at("06:00"), waitMs: 0, waitsFor: [] });
        expect(plan.get("cache")).toMatchObject({ start: at("06:10"), waitMs: 9 * MIN, waitsFor: ["files"] });
    });

    it("takes runs due at the same moment in a fixed order, so the plan does not change between two loads", () => {
        const items: QueueItem[] = [
            { key: "b", jobId: "b", due: at("06:00"), durationMs: MIN },
            { key: "a", jobId: "a", due: at("06:00"), durationMs: MIN },
        ];
        const plan = planQueue(items, 1, now);

        expect(plan.get("a")?.waitMs).toBe(0);
        expect(plan.get("b")).toMatchObject({ waitMs: MIN, waitsFor: ["a"] });
    });

    it("lets both start at once while the queue has a slot for each", () => {
        const items: QueueItem[] = [
            { key: "files", jobId: "files", due: at("06:00"), durationMs: 10 * MIN },
            { key: "cache", jobId: "cache", due: at("06:00"), durationMs: 3_000 },
        ];
        const plan = planQueue(items, 2, now);

        expect(plan.get("cache")).toMatchObject({ start: at("06:00"), waitMs: 0 });
    });

    it("keeps a running job in its slot until it is expected to end, and a queued run waits since it was queued", () => {
        const items: QueueItem[] = [
            { key: "postgres", jobId: "postgres", due: at("03:00"), startedAt: at("03:00"), durationMs: 24 * MIN },
            { key: "cache", jobId: "cache", due: at("03:00"), durationMs: 3_000 },
        ];
        const plan = planQueue(items, 1, now);

        expect(plan.get("postgres")).toMatchObject({ start: at("03:00"), end: at("03:24") });
        expect(plan.get("cache")).toMatchObject({ start: at("03:24"), waitMs: 24 * MIN, waitsFor: ["postgres"] });
    });

    it("holds a run that takes longer than usual until now, so nothing is planned in the past", () => {
        const items: QueueItem[] = [
            { key: "postgres", jobId: "postgres", due: at("02:00"), startedAt: at("02:00"), durationMs: 20 * MIN },
            { key: "cache", jobId: "cache", due: at("03:00"), durationMs: 3_000 },
        ];
        const plan = planQueue(items, 1, now);

        expect(plan.get("postgres")?.end).toBe(now);
        expect(plan.get("cache")?.start).toBe(now);
    });

    it("never runs one job twice at once, even with a free slot", () => {
        const items: QueueItem[] = [
            { key: "first", jobId: "sync", due: at("04:00"), durationMs: 8 * MIN },
            { key: "second", jobId: "sync", due: at("04:05"), durationMs: 8 * MIN },
        ];
        const plan = planQueue(items, 3, now);

        expect(plan.get("second")).toMatchObject({ start: at("04:08"), waitMs: 3 * MIN, waitsFor: ["sync"] });
    });
});
