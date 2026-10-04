import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchMock, serve } from "./database-fixtures";

let search = new URLSearchParams();
const push = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn() }),
    useSearchParams: () => search,
}));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

import { ServerPage } from "@/components/dashboard/explorer/server-page";

// cmdk scrolls the highlighted row into view, which jsdom does not implement.
Element.prototype.scrollIntoView = vi.fn();

const page = (address: string) => {
    search = new URLSearchParams(address);
    return render(<ServerPage canOpenBackups />);
};

describe("the page of a server", () => {
    beforeEach(() => {
        push.mockClear();
        serve();
    });

    it("shows where the server runs and its numbers, with back to the servers", async () => {
        page("server=s1");

        expect(await screen.findByRole("heading", { name: "Shop cluster" })).toBeInTheDocument();
        expect(await screen.findByText("PostgreSQL 16.4 on db.internal:5432 · online, 4 ms")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Back to the servers" })).toHaveAttribute("href", "/dashboard/explorer?tab=servers");
        expect(screen.getByText("99.9")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Open backups/ })).toHaveAttribute("href", "/dashboard/backups?job=nightly");
    });

    it("lists every version with how it came and the backups of it, five a page", async () => {
        const user = userEvent.setup();
        page("server=s1");

        const versions = await screen.findByRole("region", { name: "Versions" });
        expect(await within(versions).findByText("10 kept")).toBeInTheDocument();
        expect(within(versions).getByText("Now")).toBeInTheDocument();
        expect(within(versions).getByText("from 15.5, an older one")).toBeInTheDocument();
        expect(within(versions).getByText("226 made, all removed")).toBeInTheDocument();
        expect(within(versions).getByText("1 to 5 of 7 versions")).toBeInTheDocument();

        await user.click(within(versions).getByRole("button", { name: "Older versions" }));
        expect(await within(versions).findByText("added to DBackup")).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/versions?page=2&size=5"))).toBe(true);
    });

    it("lists the databases of the server with a way to each of their pages", async () => {
        page("server=s1");

        const databases = await screen.findByRole("region", { name: "Databases" });
        expect(within(databases).getByRole("link", { name: /shop/ })).toHaveAttribute("href", "/dashboard/explorer/database?server=s1&database=shop");
        expect(within(databases).getByRole("link", { name: /All 2 in Databases/ })).toHaveAttribute("href", "/dashboard/explorer?sourceId=s1");
    });

    it("says on top when the server is too old for the newest backups of its engine", async () => {
        page("server=s2");

        expect(await screen.findByText("Behind ERP test")).toBeInTheDocument();
        expect(screen.getByText(/do not restore onto ERP/)).toBeInTheDocument();
    });

    it("opens another server from the switcher", async () => {
        const user = userEvent.setup();
        page("server=s1");

        await user.click(await screen.findByRole("combobox", { name: "Open another server" }));
        await user.click(screen.getByRole("option", { name: /Cache/ }));
        await waitFor(() => expect(push).toHaveBeenLastCalledWith("/dashboard/explorer/server?server=s3"));
    });
});
