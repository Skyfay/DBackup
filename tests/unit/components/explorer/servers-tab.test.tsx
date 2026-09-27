import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onPhone, serve } from "./database-fixtures";

let search = new URLSearchParams();
const replace = vi.fn((url: string) => {
    search = new URLSearchParams(url.split("?")[1] ?? "");
});
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));
vi.mock("@/app/actions/auth/table-preferences", () => ({ saveViewLayout: vi.fn().mockResolvedValue({ success: true }) }));

import { DatabaseExplorer } from "@/components/dashboard/explorer/database-explorer";

// The columns change once the servers call answers, so a row is looked up by what only that call brings.
const rowOf = (element: HTMLElement) => element.closest("tr")!;

const explorer = () => (
    <DatabaseExplorer canOpenBackups canRestore canDownload canDelete={false} canManageVault={false} canViewHistory canExecute initialView="table" />
);

describe("the Servers tab", () => {
    beforeEach(() => {
        search = new URLSearchParams("tab=servers");
        replace.mockClear();
        push.mockClear();
        serve();
    });

    it("switches between the tabs in the address", async () => {
        search = new URLSearchParams();
        const user = userEvent.setup();
        render(explorer());

        await user.click(await screen.findByRole("tab", { name: /Servers/ }));
        expect(replace).toHaveBeenLastCalledWith("/dashboard/explorer?tab=servers", { scroll: false });
    });

    it("lists every server with where it runs, its version, how much of it is in a job and its kept backups", async () => {
        render(explorer());

        const shop = rowOf(await screen.findByText("38 kept"));
        expect(within(shop).getByRole("link", { name: "Shop cluster" })).toHaveAttribute("href", "/dashboard/explorer/server?server=s1");
        expect(within(shop).getByText("db.internal:5432")).toBeInTheDocument();
        expect(within(shop).getByText("PostgreSQL 16.4")).toBeInTheDocument();
        expect(within(shop).getByText(/of 2 in a job/)).toBeInTheDocument();
        expect(within(shop).getByText("4 ms")).toBeInTheDocument();

        const cache = rowOf(screen.getByRole("link", { name: "Cache" }));
        expect(within(cache).getByText("184.3K keys")).toBeInTheDocument();
        expect(within(cache).getByText("none kept")).toBeInTheDocument();
    });

    it("marks a server too old for the newest backups of its engine, which a quick filter keeps alone", async () => {
        const user = userEvent.setup();
        render(explorer());

        const erp = rowOf(await screen.findByText("behind ERP test, 16.0.4200"));
        expect(within(erp).getByRole("link", { name: "ERP" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Behind/ }));
        expect(screen.queryByRole("link", { name: "Shop cluster" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "ERP" })).toBeInTheDocument();
    });

    it("shows the servers as cards on a phone, each opening its page", async () => {
        await onPhone(async () => {
            render(explorer());

            expect(await screen.findByText("38 kept")).toBeInTheDocument();
            expect(screen.getByRole("link", { name: /^Shop cluster/ })).toHaveAttribute("href", "/dashboard/explorer/server?server=s1");
            expect(screen.getByText("behind ERP test, 16.0.4200")).toBeInTheDocument();
            expect(screen.getByText("none kept")).toBeInTheDocument();
            expect(screen.queryByRole("table")).not.toBeInTheDocument();
        });
    });

    it("opens a server as a page of its own on a click on its row", async () => {
        const user = userEvent.setup();
        render(explorer());

        await user.click(await screen.findByText("38 kept"));
        expect(push).toHaveBeenLastCalledWith("/dashboard/explorer/server?server=s1");
    });
});
