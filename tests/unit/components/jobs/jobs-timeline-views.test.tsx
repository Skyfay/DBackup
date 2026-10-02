import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobListItem } from "@/services/jobs/job-list-service";
import type { JobTimeline } from "@/services/jobs/job-timeline-types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

const { JobsTimeline } = await import("@/components/dashboard/jobs/timeline/jobs-timeline");
const { JobsUpcoming } = await import("@/components/dashboard/jobs/timeline/jobs-upcoming");

const MIN = 60_000;
const at = (time: string) => `2026-10-${time}:00.000Z`;

function job(id: string, name: string, schedule: string, enabled = true, nextRunAt: string | null = null): JobListItem {
    return {
        id, name, enabled, schedule, schedulePreset: null, compression: "GZIP", backupMode: "FULL", encryptionProfile: null,
        source: { id: `${id}-source`, name: `${name} source`, adapterId: "postgres", lastStatus: "ONLINE" },
        sources: [], destinations: [{ configId: "nas", priority: 0, retention: "{}", retentionPolicyId: null, retentionPolicy: null, config: { id: "nas", name: "NAS", adapterId: "local-filesystem", lastStatus: "ONLINE" } }],
        overview: { status: null, runs: [], lastRun: null, error: null, live: null, nextRunAt },
    } as unknown as JobListItem;
}

const jobs = [
    job("postgres", "Nightly Postgres", "0 3 * * *"),
    job("cache", "Cache snapshot", "0 * * * *"),
    job("files", "Files to NAS", "0 */6 * * *"),
    job("weekly", "Events weekly", "0 4 * * 0", true, at("04T04:00")),
    job("erp", "Legacy ERP", "0 22 * * *", false),
];

function data(): JobTimeline {
    const hourly = Array.from({ length: 24 }, (_, index) => {
        const due = new Date(Date.parse(at("02T04:00")) + index * 60 * MIN).toISOString();
        return { jobId: "cache", due, start: due, end: new Date(Date.parse(due) + 3_000).toISOString(), waitsFor: [] };
    });
    return {
        now: at("02T03:12"), from: at("01T00:00"), to: at("09T00:00"), slots: 1,
        estimates: { postgres: 24 * MIN, cache: 3_000, files: 10 * MIN },
        failing: [],
        runs: [
            { id: "f1", jobId: "files", status: "Partial", startedAt: at("02T00:00"), endedAt: at("02T00:11"), stage: null, progress: null, expectedStart: null, expectedEnd: null, waitsFor: [] },
            { id: "p1", jobId: "postgres", status: "Running", startedAt: at("02T03:00"), endedAt: null, stage: "Dumping", progress: 64, expectedStart: at("02T03:00"), expectedEnd: at("02T03:24"), waitsFor: [] },
            { id: "c1", jobId: "cache", status: "Pending", startedAt: at("02T03:00"), endedAt: null, stage: null, progress: null, expectedStart: at("02T03:24"), expectedEnd: at("02T03:24"), waitsFor: ["postgres"] },
        ],
        planned: [...hourly, { jobId: "files", due: at("02T06:00"), start: at("02T06:00"), end: at("02T06:10"), waitsFor: [] }],
        truncated: [],
    };
}

describe("the Timeline and Upcoming views of the Jobs page", () => {
    beforeEach(() => {
        push.mockClear();
        vi.stubGlobal("ResizeObserver", class {
            constructor(private report: (entries: { contentRect: { width: number } }[]) => void) {}
            observe() {
                this.report([{ contentRect: { width: 1200 } }]);
            }
            unobserve() {}
            disconnect() {}
        });
    });

    it("draws a row per job with what ran, runs and waits, and opens the page of a run that ran", async () => {
        const user = userEvent.setup();
        const onOpenJob = vi.fn();
        render(<JobsTimeline jobs={jobs} allJobs={jobs} timeline={{ data: data(), error: null, reload: vi.fn() }} canViewHistory onOpenJob={onOpenJob} />);

        expect(screen.getByText("Nightly Postgres")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Nightly Postgres, Running, / })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Cache snapshot, Waits in the queue, / })).toBeInTheDocument();
        expect(screen.getByText("Paused")).toBeInTheDocument();
        expect(screen.getByText(/Next run Sun/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /^Files to NAS, Partial, / }));
        expect(push).toHaveBeenCalledWith(expect.stringContaining("f1"));

        await user.click(screen.getByRole("button", { name: "Files to NAS, Planned, Fri 06:00" }));
        expect(onOpenJob).toHaveBeenCalledWith(jobs[2]);
    });

    it("lists what runs now and the plan by day, with the hourly job on one line and the rest named below", () => {
        render(<JobsUpcoming jobs={jobs} allJobs={jobs} timeline={{ data: data(), error: null, reload: vi.fn() }} onOpenJob={vi.fn()} />);

        expect(screen.getByText("Now")).toBeInTheDocument();
        expect(screen.getByText(/Nightly Postgres source holds the queue|Nightly Postgres holds the queue/)).toBeInTheDocument();
        expect(screen.getByText(/runs 24 times in the next 24 hours/)).toBeInTheDocument();
        expect(screen.getByText("Today")).toBeInTheDocument();
        expect(screen.getByText(/Not in the next 24 hours: Events weekly/)).toBeInTheDocument();
        expect(screen.getByText("Paused: Legacy ERP")).toBeInTheDocument();
    });
});
