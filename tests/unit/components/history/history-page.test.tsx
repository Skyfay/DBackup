import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchMock, notifications, onPhone, runPage, serve } from "./history-fixtures";

let search = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn((url: string) => { search = new URLSearchParams(url.split("?")[1] ?? ""); });
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, back: vi.fn(), refresh }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
const switchTenant = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant }));

import { HistoryClient } from "@/components/dashboard/history/history-client";
import { TenantViewProvider } from "@/components/tenant/tenant-view";

Element.prototype.scrollIntoView = vi.fn();
const access = { canExecute: true, canOpenJobs: true, canOpenBackups: true };
const calls = (prefix: string) => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(prefix));

describe("the History page", () => {
    beforeEach(() => {
        search = new URLSearchParams();
        push.mockClear();
        replace.mockClear();
        serve();
    });

    it("lists every run with what it did, how it ended, how long it took beside the usual time and who started it", async () => {
        render(<HistoryClient access={access} />);

        const offsite = (await screen.findByText("Google Drive failed")).closest("tr")!;
        expect(within(offsite).getByRole("link", { name: "Shop offsite" })).toHaveAttribute("href", "/dashboard/history/run?id=offsite&from=history");
        expect(within(offsite).getByText("Backup · shop, billing")).toBeInTheDocument();
        expect(within(offsite).getByText("7m 12s")).toBeInTheDocument();
        expect(within(offsite).getByText("usual 6m 50s")).toBeInTheDocument();
        expect(within(offsite).getByText("1 of 2 copies")).toBeInTheDocument();
        expect(within(offsite).getByText("Schedule")).toBeInTheDocument();
        expect(screen.getByText("Integrity check")).toBeInTheDocument();
        // No count on the tab, a dot while a job is still broken, which says what in words.
        expect(await screen.findByRole("tab", { name: "Runs, needs a look: Shop offsite failed on its last run" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
    });

    it("puts the filters beside the search and the quick filters after them, like every table", async () => {
        render(<HistoryClient access={access} />);
        await screen.findByText("Google Drive failed");

        const searchBox = screen.getByRole("textbox", { name: "Search runs" });
        const type = screen.getByRole("button", { name: /^Type/ });
        const quick = screen.getByRole("group", { name: "Filter the runs" });
        expect(searchBox.compareDocumentPosition(type) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(type.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("keeps the system tasks under a heading of their own in the Type filter", async () => {
        const user = userEvent.setup();
        render(<HistoryClient access={access} />);
        await screen.findByText("Google Drive failed");

        await user.click(screen.getByRole("button", { name: /^Type/ }));
        expect(await screen.findByText("System tasks")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Integrity check/ })).toBeInTheDocument();
        expect(screen.getByText("Jobs")).toBeInTheDocument();
    });

    it("asks the server for the failed runs when the quick filter says so", async () => {
        const user = userEvent.setup();
        render(<HistoryClient access={access} />);
        await screen.findByText("Google Drive failed");

        await user.click(screen.getByRole("button", { name: /Failed/ }));
        await waitFor(() => expect(calls("/api/history/runs?").some((url) => url.includes("status=Failed"))).toBe(true));
    });

    it("opens a run as its page on a click on its row", async () => {
        const user = userEvent.setup();
        render(<HistoryClient access={access} />);

        await user.click(await screen.findByText("Google Drive failed"));
        expect(push).toHaveBeenCalledWith("/dashboard/history/run?id=offsite&from=history");
    });

    it("shows the runs as cards on a phone", async () => {
        await onPhone(async () => {
            render(<HistoryClient access={access} />);
            expect(await screen.findByText("Google Drive failed")).toBeInTheDocument();
            expect(screen.queryByRole("table")).not.toBeInTheDocument();
            expect(screen.getByRole("link", { name: /^Shop offsite/ })).toHaveAttribute("href", "/dashboard/history/run?id=offsite&from=history");
        });
    });
});

describe("the notifications of the History page", () => {
    beforeEach(() => {
        search = new URLSearchParams("tab=notifications");
        serve();
    });

    it("lists every message with its channel and whether it went out, and opens one in the side panel", async () => {
        const user = userEvent.setup();
        render(<HistoryClient access={access} />);

        const telegram = (await screen.findByText("Telegram Manu", { selector: "p" })).closest("tr")!;
        expect(within(telegram).getAllByText("403 Forbidden: bot was blocked by the user")).not.toHaveLength(0);

        await user.click(within(telegram).getByText("Telegram Manu", { selector: "p" }));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).getByText("Telegram Manu did not take it")).toBeInTheDocument();
        expect(within(panel).getByRole("link", { name: /Open run/ })).toHaveAttribute("href", "/dashboard/history/run?id=offsite&from=history");
        expect(await within(panel).findByText("The same message")).toBeInTheDocument();
    });

    it("asks for the notifications of one channel", async () => {
        const user = userEvent.setup();
        render(<HistoryClient access={access} />);
        await screen.findByText("Telegram Manu", { selector: "p" });

        await user.click(screen.getByRole("button", { name: /^Channel/ }));
        await user.click(await screen.findByRole("option", { name: /Telegram Manu/ }));
        await waitFor(() => expect(calls("/api/notification-logs?").some((url) => url.includes("channel=Telegram+Manu"))).toBe(true));
    });
});

describe("the History page in All tenants", () => {
    const tenants = [{ id: "acme", name: "Acme GmbH" }, { id: "globex", name: "Globex AG" }];
    const inAllTenants = () => render(
        <TenantViewProvider value={{ tenants, activeTenantId: null, allTenants: true, isPlatformAdmin: true }}>
            <HistoryClient access={access} />
        </TenantViewProvider>
    );
    // Shop offsite runs for Acme, CRM daily and the integrity check for Globex.
    const tenantOf = (id: string) => (id === "offsite" ? "acme" : "globex");
    const everyTenant = {
        ...runPage,
        rows: runPage.rows.map((run) => ({ ...run, tenantId: tenantOf(run.id) })),
        facets: { ...runPage.facets, tenant: { acme: 1, globex: 2 } },
    };

    beforeEach(() => {
        search = new URLSearchParams();
        push.mockClear();
        switchTenant.mockReset();
        serve({ page: everyTenant, logs: notifications.map((entry) => ({ ...entry, tenantId: "acme" })), logTenants: { acme: 2 } });
    });

    it("names the tenant of every run and asks the server for the runs of the tenant picked in its filter", async () => {
        const user = userEvent.setup();
        inAllTenants();

        const offsite = (await screen.findByText("Google Drive failed")).closest("tr")!;
        expect(within(offsite).getByText("Acme GmbH")).toBeInTheDocument();
        expect(within(screen.getByText("CRM daily").closest("tr")!).getByText("Globex AG")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /^Tenant/ }));
        await user.click(await screen.findByRole("option", { name: /Globex AG/ }));
        await waitFor(() => expect(calls("/api/history/runs?").some((url) => url.includes("tenant=globex"))).toBe(true));
    });

    it("opens a run in its tenant from its menu and offers no way to run it again or cancel it there", async () => {
        const user = userEvent.setup();
        switchTenant.mockResolvedValue({ success: true, data: { id: "globex", name: "Globex AG" } });
        inAllTenants();

        await user.click(await screen.findByRole("button", { name: "Open menu for CRM daily" }));
        expect(screen.queryByRole("menuitem", { name: /Cancel run/ })).not.toBeInTheDocument();
        await user.click(await screen.findByRole("menuitem", { name: "Open in Globex AG" }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("globex"));
        expect(push).toHaveBeenCalledWith("/dashboard/history/run?id=crm&from=history");

        await user.click(screen.getByRole("button", { name: "Open menu for Shop offsite" }));
        expect(await screen.findByRole("menuitem", { name: "Open run" })).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: /Run again/ })).not.toBeInTheDocument();
    });

    it("still opens a run as its page on a click on its row, which reads it in All tenants", async () => {
        const user = userEvent.setup();
        inAllTenants();

        await user.click(await screen.findByText("Google Drive failed"));
        expect(push).toHaveBeenCalledWith("/dashboard/history/run?id=offsite&from=history");
        expect(switchTenant).not.toHaveBeenCalled();
    });

    it("names the tenant on the card of each run on a phone", async () => {
        await onPhone(async () => {
            inAllTenants();
            const card = await screen.findByRole("link", { name: /^Shop offsite/ });
            expect(within(card).getByText("Acme GmbH")).toBeInTheDocument();
        });
    });

    it("names the tenant of every notification and opens its channel in that tenant", async () => {
        search = new URLSearchParams("tab=notifications");
        const user = userEvent.setup();
        switchTenant.mockResolvedValue({ success: true, data: { id: "acme", name: "Acme GmbH" } });
        inAllTenants();

        const telegram = (await screen.findByText("Telegram Manu", { selector: "p" })).closest("tr")!;
        expect(within(telegram).getByText("Acme GmbH")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /^Tenant/ }));
        await user.click(await screen.findByRole("option", { name: /Acme GmbH/ }));
        await waitFor(() => expect(calls("/api/notification-logs?").some((url) => url.includes("tenant=acme"))).toBe(true));
        await user.keyboard("{Escape}");

        await user.click(within(telegram).getByText("Telegram Manu", { selector: "p" }));
        const panel = await screen.findByRole("dialog");
        expect(within(panel).queryByRole("link", { name: /Open channel/ })).not.toBeInTheDocument();
        await user.click(within(panel).getByRole("button", { name: "Open channel in Acme GmbH" }));
        await waitFor(() => expect(switchTenant).toHaveBeenCalledWith("acme"));
        expect(push).toHaveBeenCalledWith("/dashboard/connections?tab=notifications");
    });
});
