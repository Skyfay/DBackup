import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { JobForm } from "@/components/dashboard/jobs/job-form";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import type { JobListItem } from "@/services/jobs/job-list-service";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timeFormat: "HH:mm" } } }) }));
vi.mock("@/app/actions/templates", () => {
    const empty = () => Promise.resolve({ success: true, data: [] });
    return { getSchedulePresets: empty, getNotificationTemplates: empty, getExcludePatternPresets: empty, getRetentionPolicies: empty, getNamingTemplates: empty };
});

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
const mockFetch = vi.fn((url: string, _init?: RequestInit) => {
    if (url === "/api/system/timezone") return json({ schedulerTimezone: "UTC" });
    if (url.startsWith("/api/adapters?type=notification")) return json([]);
    if (url === "/api/jobs") return json({ id: "job-new" });
    if (url === "/api/jobs/job-1") return json({ id: "job-1" });
    return json({ error: `Unexpected ${url}` }, false);
});

const sources: AdapterOption[] = [{ id: "db-1", name: "Shop", adapterId: "mysql" }];
const destinations: AdapterOption[] = [
    { id: "nas", name: "NAS", adapterId: "sftp", storageRole: "DESTINATION" },
    { id: "files", name: "App server", adapterId: "sftp", storageRole: "SOURCE" },
];

function renderForm(initialData: JobListItem | null = null, onSaved = vi.fn()) {
    render(
        <Dialog open>
            <DialogContent>
                <JobForm
                    sources={sources}
                    destinations={destinations}
                    directorySourceOptions={destinations.filter((option) => option.storageRole === "SOURCE")}
                    notifications={[]}
                    encryptionProfiles={[{ id: "key-1", name: "Backup key" }]}
                    initialData={initialData}
                    onSaved={onSaved}
                />
            </DialogContent>
        </Dialog>
    );
    return onSaved;
}

const posted = (url: string, method: string) => {
    const call = mockFetch.mock.calls.find(([called, init]) => called === url && init?.method === method);
    return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

async function pick(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, option: RegExp) {
    await user.click(combobox);
    await user.click(await screen.findByRole("option", { name: option }));
}

describe("job form", () => {
    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("opens the part with the missing field when Create finds one, instead of doing nothing", async () => {
        const user = userEvent.setup();
        renderForm();

        await user.type(screen.getByLabelText("Name"), "Shop nightly");
        await user.click(screen.getByRole("button", { name: "Create job" }));

        const part = await screen.findByRole("tab", { name: /What goes in/ });
        await waitFor(() => expect(part).toHaveAttribute("aria-selected", "true"));
        expect(screen.getByRole("tabpanel", { name: /What goes in/ })).toHaveTextContent("Pick the database to back up.");
        expect(posted("/api/jobs", "POST")).toBeUndefined();
    });

    it("creates a job from its parts, the destination on the default policy", async () => {
        const user = userEvent.setup();
        const onSaved = renderForm();

        await user.type(screen.getByLabelText("Name"), "Shop nightly");
        await user.click(screen.getByRole("tab", { name: /What goes in/ }));
        await pick(user, screen.getByRole("combobox", { name: "Database" }), /^Shop/);
        await user.click(screen.getByRole("tab", { name: /Destinations/ }));
        const destinationsPart = screen.getByRole("tabpanel", { name: /Destinations/ });
        // Only destinations are offered, a directory source never is.
        await user.click(within(destinationsPart).getByRole("combobox", { name: "Destination 1" }));
        expect(screen.queryByRole("option", { name: /App server/ })).not.toBeInTheDocument();
        await user.click(await screen.findByRole("option", { name: /^NAS/ }));
        await user.click(screen.getByRole("button", { name: "Create job" }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(posted("/api/jobs", "POST")).toMatchObject({
            name: "Shop nightly",
            schedule: "0 3 * * *",
            enabled: true,
            sourceId: "db-1",
            databases: [],
            sources: [],
            destinations: [{ configId: "nas", priority: 0, retention: {}, retentionPolicyId: null }],
            encryptionProfileId: "",
        });
    });

    it("saves an edited job with what it had, in the violet of editing", async () => {
        const user = userEvent.setup();
        const job = {
            id: "job-1",
            name: "Shop nightly",
            schedule: "0 2 * * 0",
            enabled: false,
            sourceId: "db-1",
            databases: "[]",
            encryptionProfileId: "key-1",
            compression: "GZIP",
            pgCompression: "",
            notificationEvents: "PARTIAL|FAILED",
            namingTemplateId: null,
            schedulePresetId: null,
            skipVerification: true,
            backupMode: "FULL",
            fullEveryDays: 7,
            verifyByHash: false,
            createdAt: "2026-03-12T10:00:00.000Z",
            source: { id: "db-1", name: "Shop", adapterId: "mysql", lastStatus: "ONLINE" },
            destinations: [{ configId: "nas", priority: 0, retention: "{}", retentionPolicyId: null, retentionPolicy: null, config: { id: "nas", name: "NAS", adapterId: "sftp", lastStatus: "ONLINE" } }],
            sources: [],
            notifications: [],
            notificationTemplates: [],
            encryptionProfile: { id: "key-1", name: "Backup key" },
            schedulePreset: null,
            namingTemplate: null,
            overview: { status: null, runs: [], lastRun: null, error: null, live: null, nextRunAt: null },
        } as unknown as JobListItem;
        const onSaved = renderForm(job);

        expect(screen.getByRole("button", { name: "Save changes" }).closest("form")).toHaveAttribute("data-tone", "edit");
        await user.click(screen.getByRole("button", { name: "Save changes" }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(posted("/api/jobs/job-1", "PUT")).toMatchObject({ schedule: "0 2 * * 0", enabled: false, encryptionProfileId: "key-1", compression: "GZIP", skipVerification: true });
    });
});
