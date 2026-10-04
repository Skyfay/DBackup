import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExcludeTab } from "@/components/dashboard/templates/exclude-tab";
import { RetentionTab } from "@/components/dashboard/templates/retention-tab";
import { ScheduleTab } from "@/components/dashboard/templates/schedule-tab";
import { deleteRetentionPolicy } from "@/app/actions/templates";
import { getRetentionPolicyTargets } from "@/app/actions/templates-retention";
import { ExcludePatternPresetDialog } from "@/components/settings/templates/exclude-pattern-preset-dialog";
import { RetentionPolicyDialog } from "@/components/settings/templates/retention-policy-dialog";
import type { TemplatesModel } from "@/services/templates/templates-types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/actions/auth/table-preferences", () => ({ saveTableLayout: vi.fn(async () => ({ success: true })) }));
vi.mock("@/app/actions/templates-retention", () => ({
    getRetentionPolicyTargets: vi.fn(async () => ({ success: true, data: { timezone: "UTC", targets: [], unlisted: [] } })),
}));
vi.mock("@/app/actions/templates", () => ({
    createExcludePatternPreset: vi.fn(),
    createNamingTemplate: vi.fn(),
    createNotificationTemplate: vi.fn(),
    createRetentionPolicy: vi.fn(),
    createSchedulePreset: vi.fn(),
    deleteExcludePatternPreset: vi.fn(),
    deleteNamingTemplate: vi.fn(),
    deleteNotificationTemplate: vi.fn(),
    deleteRetentionPolicy: vi.fn(),
    deleteSchedulePreset: vi.fn(),
    setDefaultNotificationTemplate: vi.fn(),
    setDefaultRetentionPolicy: vi.fn(),
    unsetDefaultNotificationTemplate: vi.fn(),
    updateExcludePatternPreset: vi.fn(),
    updateNamingTemplate: vi.fn(),
    updateRetentionPolicy: vi.fn(),
    updateSchedulePreset: vi.fn(),
}));
vi.mock("@/app/actions/templates-bulk", () => ({
    bulkDeleteExcludePatternPresets: vi.fn(),
    bulkDeleteNamingTemplates: vi.fn(),
    bulkDeleteNotificationTemplates: vi.fn(),
    bulkDeleteRetentionPolicies: vi.fn(),
    bulkDeleteSchedulePresets: vi.fn(),
}));

const STAMP = { description: null, createdAt: "2026-03-14T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z" };
const JOB = { enabled: true, sourceType: "postgres", hasFolders: false, incremental: false, databases: [] };

const MODEL: TemplatesModel = {
    timezone: "UTC",
    channels: [],
    jobs: [
        { ...JOB, id: "shop", name: "Shop nightly", schedule: "0 3 * * *" },
        { ...JOB, id: "wiki", name: "Wiki weekly", schedule: "0 2 * * 0", sourceType: "mariadb" },
        { ...JOB, id: "photos", name: "Photos", schedule: "0 0 * * *", sourceType: null, hasFolders: true },
    ],
    retention: [
        {
            ...STAMP,
            id: "company",
            name: "Company default",
            config: { mode: "SMART", smart: { daily: 7, weekly: 4, monthly: 12, yearly: 2 } },
            isDefault: true,
            isSystem: false,
            uses: [{ jobId: "shop", destinationId: "nas", destinationName: "NAS Backups", adapterId: "smb", how: "default" }],
            prefills: [],
        },
        {
            ...STAMP,
            id: "offsite",
            name: "Offsite 30",
            description: "For copies that leave the house",
            config: { mode: "SIMPLE", simple: { keepCount: 30 } },
            isDefault: false,
            isSystem: false,
            uses: [{ jobId: "wiki", destinationId: "r2", destinationName: "Cloudflare R2", adapterId: "s3", how: "picked" }],
            prefills: [],
        },
        { ...STAMP, id: "week", name: "Keep a week", config: { mode: "SIMPLE", simple: { keepCount: 7 } }, isDefault: false, isSystem: false, uses: [], prefills: [] },
    ],
    retentionTotals: { destinations: 2, picked: 1, followDefault: 1, own: 0 },
    naming: [],
    namingTotals: { jobs: 3, picked: 0, followDefault: 3 },
    schedules: [{ ...STAMP, id: "3am", name: "Daily at 3 AM", schedule: "0 3 * * *", jobIds: ["shop"] }],
    notifications: [],
    excludes: [
        {
            ...STAMP,
            id: "junk",
            name: "System Junk Files",
            patterns: [],
            groups: ["macos"],
            excludedGroupPatterns: [],
            isDefault: true,
            isSystem: false,
            folders: [{ id: "f1", jobId: "photos", connectionId: "nas-src", connectionName: "Photos share", adapterId: "smb", path: "/volume1/photo" }],
        },
    ],
    folders: { total: 1, withPreset: 1 },
};

const props = (canManage = true) => ({ model: MODEL, isLoading: false, refresh: vi.fn(), afterChange: vi.fn(), cards: false, canManage, initialLayout: null });

describe("RetentionTab", () => {
    beforeEach(() => vi.clearAllMocks());

    it("lists each policy with what it keeps and the destinations that follow it", () => {
        render(<RetentionTab {...props()} />);

        expect(screen.getByRole("button", { name: "Company default" })).toBeInTheDocument();
        expect(screen.getByText("7 daily, 4 weekly, 12 monthly, 2 yearly")).toBeInTheDocument();
        // Once in the numbers above the list and once in the row of the default.
        expect(screen.getAllByText("1 destination follows it")).toHaveLength(2);
        expect(screen.getByText("Keeps the last 30")).toBeInTheDocument();
    });

    it("offers nothing but looking without the right to write templates", async () => {
        const user = userEvent.setup();
        render(<RetentionTab {...props(false)} />);

        expect(screen.queryByRole("button", { name: /Open menu for/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Offsite 30" }));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByRole("link", { name: "Cloudflare R2 of Wiki weekly" })).toHaveAttribute("href", "/dashboard/jobs?job=wiki");
        expect(within(panel).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: /Make default/ })).not.toBeInTheDocument();
    });

    it("keeps the default policy from being deleted and says why", async () => {
        const user = userEvent.setup();
        render(<RetentionTab {...props()} />);

        await user.click(screen.getByRole("button", { name: "Open menu for Company default" }));
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

        const dialog = await screen.findByRole("alertdialog");
        expect(within(dialog).getByText("The default policy")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Delete policy" })).toBeDisabled();
    });
});

describe("RetentionTab deletes", () => {
    beforeEach(() => vi.clearAllMocks());

    it("deletes a policy nothing uses after asking with its name", async () => {
        const user = userEvent.setup();
        vi.mocked(deleteRetentionPolicy).mockResolvedValue({ success: true });
        const tab = props();
        render(<RetentionTab {...tab} />);

        await user.click(screen.getByRole("button", { name: "Open menu for Keep a week" }));
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
        const dialog = await screen.findByRole("alertdialog");
        expect(within(dialog).getByText("Keep a week")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Delete policy" }));

        expect(deleteRetentionPolicy).toHaveBeenCalledWith("week");
        expect(tab.afterChange).toHaveBeenCalled();
    });
});

describe("ScheduleTab", () => {
    beforeEach(() => vi.clearAllMocks());

    it("says that the jobs of a deleted preset keep running at its time on their own", async () => {
        const user = userEvent.setup();
        render(<ScheduleTab {...props()} />);

        await user.click(screen.getByRole("button", { name: "Open menu for Daily at 3 AM" }));
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

        const dialog = await screen.findByRole("alertdialog");
        expect(within(dialog).getByText("They keep running every day at 03:00 on their own. A later change of a preset no longer reaches them.")).toBeInTheDocument();
        expect(within(dialog).getByRole("link", { name: "Shop nightly" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Delete preset" })).toBeEnabled();
    });
});

describe("ExcludeTab", () => {
    beforeEach(() => vi.clearAllMocks());

    it("says that the folders of a deleted preset lose its patterns", async () => {
        const user = userEvent.setup();
        render(<ExcludeTab {...props()} />);

        await user.click(screen.getByRole("button", { name: "Open menu for System Junk Files" }));
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

        const dialog = await screen.findByRole("alertdialog");
        expect(within(dialog).getByText(/This folder loses its 7 patterns\. From their next run they back up what it skipped/)).toBeInTheDocument();
        expect(within(dialog).getByRole("link", { name: "/volume1/photo" })).toBeInTheDocument();
    });
});

describe("ExcludePatternPresetDialog", () => {
    it("checks a path the way the backup matches it", async () => {
        const user = userEvent.setup();
        render(
            <ExcludePatternPresetDialog
                open
                onOpenChange={vi.fn()}
                preset={{ id: "node", name: "Node.js project", description: null, patterns: ["*.log"], groups: ["dev"], excludedGroupPatterns: ["dist/**"] }}
                onSuccess={vi.fn()}
            />
        );

        const field = screen.getByLabelText("Check a path");
        await user.type(field, "apps/web/node_modules/react/index.js");
        let verdict = screen.getByRole("status");
        expect(within(verdict).getByText("Skipped")).toBeInTheDocument();
        expect(within(verdict).getByText("**/node_modules/**")).toBeInTheDocument();
        expect(verdict).toHaveTextContent("of Development artifacts");

        // The preset left dist/** of its group out, stored in the form the group had then.
        await user.clear(field);
        await user.type(field, "dist/app.js");
        expect(within(screen.getByRole("status")).getByText("Backed up")).toBeInTheDocument();

        await user.clear(field);
        await user.type(field, "/today.log");
        verdict = screen.getByRole("status");
        expect(verdict).toHaveTextContent("by *.log of its own patterns");
    });
});

describe("RetentionPolicyDialog", () => {
    it("says what the next run of each destination removes while the policy changes", async () => {
        const user = userEvent.setup();
        const day = 86_400_000;
        vi.mocked(getRetentionPolicyTargets).mockResolvedValueOnce({
            success: true,
            data: {
                timezone: "UTC",
                unlisted: [],
                targets: [{
                    jobId: "wiki",
                    jobName: "Wiki weekly",
                    destinationId: "r2",
                    destinationName: "Cloudflare R2",
                    adapterId: "s3",
                    how: "picked",
                    nextRun: new Date(Date.now() + day / 2).toISOString(),
                    chains: false,
                    backups: Array.from({ length: 10 }, (_, index) => ({ at: new Date(Date.now() - (index + 1) * day).toISOString(), locked: false, chainId: null })),
                }],
            },
        });
        render(<RetentionPolicyDialog open onOpenChange={vi.fn()} policy={MODEL.retention[1]} onSuccess={vi.fn()} />);

        expect(await screen.findByText("Cloudflare R2 of Wiki weekly")).toBeInTheDocument();
        expect(screen.getByText("removes none")).toBeInTheDocument();
        expect(screen.getByText("A change applies to its destination")).toBeInTheDocument();

        const backups = screen.getByRole("spinbutton", { name: "Backups" });
        await user.clear(backups);
        await user.type(backups, "5");

        expect(screen.getByText("removes 6")).toBeInTheDocument();
        expect(screen.getByText("holds 10, keeps 4")).toBeInTheDocument();
        expect(screen.getByText("The next runs remove 6 backups at 1 destination. Nothing is removed on save.")).toBeInTheDocument();
        expect(screen.getByText("Backups").nextSibling).toHaveTextContent("was 30");
    });
});
