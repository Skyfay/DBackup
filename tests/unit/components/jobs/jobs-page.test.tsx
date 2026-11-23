import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobListItem } from "@/services/jobs/job-list-service";
import type { JobPage } from "@/services/jobs/job-page-types";

let search = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, refresh: vi.fn() }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: vi.fn() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({
    saveViewLayout: vi.fn().mockResolvedValue({ success: true }),
    saveTableLayout: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/components/dashboard/widgets/use-run-job", () => ({ useRunJob: () => ({ runJob: vi.fn(), startingJobId: null }) }));

const { JobsClient } = await import("@/app/dashboard/jobs/jobs-client");

Element.prototype.scrollIntoView = vi.fn();

function job(index: number, overrides: Partial<JobListItem> = {}): JobListItem {
    const id = `job-${index}`;
    return {
        id, name: `${index % 5 === 0 ? "Shop" : "Job"} ${index}`, tenantId: "default", enabled: true, schedule: "0 3 * * *", schedulePreset: null,
        compression: "GZIP", backupMode: "FULL", encryptionProfile: null, createdAt: "2026-10-01T00:00:00.000Z",
        source: { id: `${id}-source`, name: "Shop cluster", adapterId: "postgres", lastStatus: "ONLINE" },
        sources: [], notifications: [], notificationTemplates: [], databases: "[]",
        destinations: [{ configId: "nas", priority: 0, retention: "{}", retentionPolicyId: null, retentionPolicy: null, config: { id: "nas", name: "NAS", adapterId: "local-filesystem", lastStatus: "ONLINE" } }],
        overview: { status: null, runs: [], lastRun: null, error: null, live: null, nextRunAt: null },
        ...overrides,
    } as unknown as JobListItem;
}

/** 40 jobs, the newest first, as the server holds them. */
const every = Array.from({ length: 40 }, (_, index) => job(index));

/** Answers the list route like the server: a page of the jobs the search and the quick filter leave. */
function serve() {
    const fetchMock = vi.fn((url: string) => {
        const [path, query = ""] = url.split("?");
        const params = new URLSearchParams(query);
        if (path === "/api/jobs/list") {
            const ids = params.getAll("id");
            const term = (params.get("search") ?? "").toLowerCase();
            const filter = params.get("filter") ?? "all";
            const shown = ids.length > 0
                ? every.filter((entry) => ids.includes(entry.id))
                : every.filter((entry) => entry.name.toLowerCase().includes(term) && (filter !== "paused" || !entry.enabled));
            const size = Number(params.get("pageSize") ?? 25);
            const page = Number(params.get("page") ?? 1);
            const data: JobPage = {
                rows: ids.length > 0 ? shown : shown.slice((page - 1) * size, page * size),
                total: shown.length,
                counts: { all: 40, attention: 3, running: 1, paused: 0 },
                stats: {
                    total: 40, paused: 0, runs: { succeeded: 9, partial: 0, failed: 1 },
                    failed: { count: 3, names: ["Job 7", "Job 8", "Job 9"] }, partial: { count: 0, names: [] },
                    next: null, running: { count: 1, jobs: [{ name: "Job 1", progress: 40 }] }, waiting: 0,
                },
                live: true,
            };
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) } as Response);
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ success: false, error: `Unexpected ${url}` }) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const page = () => render(
    <JobsClient canManage canExecute canViewHistory canViewStorage sources={[]} destinations={[]} notificationChannels={[]} encryptionProfiles={[]} initialLayout={null} initialView="table" />,
);
const listCalls = (fetchMock: ReturnType<typeof serve>) => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/jobs/list?"));

describe("the Jobs page", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        push.mockClear();
        replace.mockClear();
    });

    it("shows one page of the jobs and the numbers of every job, as the server counts them", async () => {
        const fetchMock = serve();
        page();

        expect(await screen.findByRole("button", { name: "Job 1" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Job 30" })).not.toBeInTheDocument();
        expect(listCalls(fetchMock)[0]).toContain("page=1&pageSize=20");
        // The numbers count every job, not the page.
        expect(screen.getByText("Job 7 and 2 more failed")).toBeInTheDocument();
        const quick = screen.getByRole("group", { name: "Filter by status" });
        expect(within(quick).getByRole("button", { name: /Needs attention\s*3/ })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Job 7 and 2 more failed on their last run/ })).toBeInTheDocument();
        expect(screen.getByText("Total 40 row(s).")).toBeInTheDocument();
        expect(screen.getByText(/Page 1 of/)).toHaveTextContent("Page 1 of 2");
    });

    it("asks the server for the next page, a search and a quick filter, each from its first page", async () => {
        const fetchMock = serve();
        const user = userEvent.setup();
        page();
        await screen.findByRole("button", { name: "Job 1" });

        await user.click(screen.getByRole("button", { name: "Go to next page" }));
        expect(await screen.findByRole("button", { name: "Job 21" })).toBeInTheDocument();
        expect(listCalls(fetchMock).at(-1)).toContain("page=2&pageSize=20");

        await user.type(screen.getByRole("textbox", { name: "Search jobs" }), "shop");
        await waitFor(() => expect(listCalls(fetchMock).at(-1)).toContain("search=shop"));
        expect(listCalls(fetchMock).at(-1)).toContain("page=1&");
        expect(await screen.findByRole("button", { name: "Shop 35" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Job 1" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Needs attention/ }));
        await waitFor(() => expect(listCalls(fetchMock).at(-1)).toContain("filter=attention"));
    });

    it("opens the job a link names, also when it is not on the first page", async () => {
        const fetchMock = serve();
        search = new URLSearchParams("job=job-33");
        page();

        expect(await screen.findByRole("heading", { name: "Job 33" })).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/jobs/list?id=job-33")).toBe(true);
    });
});
