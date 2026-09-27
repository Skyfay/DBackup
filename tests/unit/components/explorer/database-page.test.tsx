import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { posted, serve } from "./database-fixtures";

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

import { DatabasePage } from "@/components/dashboard/explorer/database-page";

// cmdk scrolls the highlighted row into view, which jsdom does not implement.
Element.prototype.scrollIntoView = vi.fn();

const page = (address: string) => {
    search = new URLSearchParams(address);
    return render(<DatabasePage canBrowse canOpenBackups />);
};

describe("the page of a database", () => {
    beforeEach(() => {
        replace.mockClear();
        push.mockClear();
    });

    it("lists the tables, keeps the picked one in the address and reads its rows sorted by a click on a column", async () => {
        serve();
        const user = userEvent.setup();
        const view = page("server=s1&database=shop");

        expect(await screen.findByRole("heading", { name: "shop" })).toBeInTheDocument();
        expect(screen.getByText("A database of Shop cluster · PostgreSQL 16.4")).toBeInTheDocument();
        await user.click(await screen.findByRole("button", { name: /orders/ }));
        expect(replace).toHaveBeenLastCalledWith("/dashboard/explorer/database?server=s1&database=shop&table=orders", { scroll: false });

        view.rerender(<DatabasePage canBrowse canOpenBackups />);
        expect(await screen.findByText("paid")).toBeInTheDocument();
        expect(posted("/api/adapters/database-table-data")[0]).toMatchObject({ sourceId: "s1", database: "shop", table: "orders", page: 1, pageSize: 50 });

        await user.click(screen.getByRole("button", { name: /status/ }));
        await waitFor(() => expect(posted("/api/adapters/database-table-data").at(-1)).toMatchObject({ sortBy: "status", sortDir: "asc" }));
        expect(await screen.findByText("shipped")).toBeInTheDocument();
    });

    it("says why the tables stay closed when the login of the server may not list them", async () => {
        serve({ tables: { success: false, message: "The SELECT permission was denied on the object 'orders'" } });
        page("server=s2&database=erp");

        expect(await screen.findByText("The tables could not be listed")).toBeInTheDocument();
        expect(screen.getByText("The SELECT permission was denied on the object 'orders'")).toBeInTheDocument();
        expect(screen.getByText(/Its backups do not depend on it/)).toBeInTheDocument();
    });

    it("shows a Redis server with its numbered databases, the empty ones folded into one line", async () => {
        serve();
        const user = userEvent.setup();
        page("server=s3");

        expect(await screen.findByRole("heading", { name: "Cache" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /db0/ })).toHaveTextContent("184,332 keys");
        expect(screen.getByRole("button", { name: /db3/ })).toBeInTheDocument();
        const fold = screen.getByRole("button", { name: /14 empty databases/ });
        expect(fold).toHaveTextContent("db1, db2, db4 to db15");
        expect(screen.queryByRole("button", { name: /^db1(?!\d)/ })).not.toBeInTheDocument();

        await user.click(fold);
        expect(screen.getByRole("button", { name: /^db1(?!\d)/ })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /db0/ }));
        expect(replace).toHaveBeenLastCalledWith("/dashboard/explorer/database?server=s3&table=0", { scroll: false });
    });

    it("reads the keys of a numbered database without pages and filters them by the key on the server", async () => {
        serve();
        const user = userEvent.setup();
        page("server=s3&table=0");

        expect(await screen.findByText("session:1")).toBeInTheDocument();
        expect(posted("/api/adapters/database-table-data")[0]).toMatchObject({ sourceId: "s3", database: "0", table: "Keys" });
        expect(screen.getByText("The first 3 of 184,332 keys, a filter finds the others")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Filter" }));
        const popover = await screen.findByRole("dialog");
        await user.click(within(popover).getByRole("tab", { name: "Starts with" }));
        await user.type(within(popover).getByLabelText("Value"), "session:");
        await user.click(within(popover).getByRole("button", { name: "Filter" }));

        await waitFor(() => expect(posted("/api/adapters/database-table-data").at(-1)).toMatchObject({ search: "session:", searchColumn: "key", matchMode: "starts" }));
        expect(await screen.findByText("2 keys match")).toBeInTheDocument();
    });

    it("opens another database of any server from the switcher", async () => {
        serve();
        const user = userEvent.setup();
        page("server=s1&database=shop");

        await user.click(await screen.findByRole("combobox", { name: "Open another database" }));
        expect(screen.getByRole("option", { name: /Cache/ })).toHaveTextContent("Redis 7.2.5 · 184.3K keys");
        await user.click(screen.getByRole("option", { name: /erp/ }));
        expect(push).toHaveBeenLastCalledWith("/dashboard/explorer/database?server=s2&database=erp");
    });

    it("says so when the database is no longer listed", async () => {
        serve();
        page("server=s1&database=gone");

        expect(await screen.findByText("gone is not listed")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Back to the Database Explorer/ })).toHaveAttribute("href", "/dashboard/explorer");
    });
});
