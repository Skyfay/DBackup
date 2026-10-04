import { describe, expect, it } from "vitest";
import { buildSteps, median, parseLog, usualSteps } from "@/services/history/run-steps";
import { offsiteLog } from "./run-fixtures";

const NOW = Date.parse("2026-09-27T04:08:00.000Z");

describe("parseLog", () => {
    it("reads structured lines and keeps old plain lines as info", () => {
        const entries = parseLog(JSON.stringify(["old line", { timestamp: "t", level: "error", message: "boom", stage: "Uploading" }, 42]));
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({ level: "info", message: "old line", stage: "General" });
        expect(entries[1]).toMatchObject({ level: "error", message: "boom", stage: "Uploading", type: "general" });
    });

    it("reads nothing from a missing or broken log", () => {
        expect(parseLog(null)).toEqual([]);
        expect(parseLog("{nope")).toEqual([]);
    });
});

describe("buildSteps", () => {
    const steps = buildSteps(offsiteLog, { type: "Backup", status: "Partial", currentStage: null, now: NOW, usual: new Map([["Uploading", 150_000]]) });
    const step = (name: string) => steps.find((entry) => entry.name === name)!;

    it("lists the steps of a backup in their order, without the short queue and the closing step", () => {
        expect(steps.map((entry) => entry.name)).toEqual([
            "Initializing", "Dumping Databases", "Collecting Files", "Processing", "Uploading", "Verifying", "Applying Retention", "Sending Notifications",
        ]);
    });

    it("tells how each step ended, with its time next to the usual one", () => {
        expect(step("Initializing")).toMatchObject({ state: "done", durationMs: 800 });
        expect(step("Dumping Databases")).toMatchObject({ state: "warning", warnings: 1, durationMs: 190_000 });
        expect(step("Uploading")).toMatchObject({ state: "failed", errors: 1, warnings: 2, durationMs: 170_000, usualMs: 150_000 });
        expect(step("Processing")).toMatchObject({ state: "skipped", lines: [] });
    });

    it("leaves the line that ends a step out of its lines", () => {
        expect(step("Dumping Databases").lines.map((line) => line.message)).not.toContain("Dumping Databases completed (3m 10s)");
    });

    it("counts a live step up to now and shows the ones to come as pending", () => {
        const live = buildSteps(offsiteLog.slice(0, 8), { type: "Backup", status: "Running", currentStage: "Uploading", now: NOW, usual: new Map() });
        const uploading = live.find((entry) => entry.name === "Uploading")!;
        expect(uploading.state).toBe("running");
        expect(uploading.durationMs).toBe(NOW - Date.parse("2026-09-27T04:04:15.000Z"));
        expect(live.find((entry) => entry.name === "Verifying")!.state).toBe("pending");
    });
});

describe("usualSteps", () => {
    it("takes the median time of every step over earlier runs", () => {
        const run = (ms: number) => [{ timestamp: "t", level: "success" as const, type: "general" as const, message: "Uploading completed", stage: "Uploading", durationMs: ms }];
        expect(usualSteps([run(100), run(300), run(200)]).get("Uploading")).toBe(200);
        expect(median([])).toBeNull();
        expect(median([1, 3])).toBe(2);
    });
});
