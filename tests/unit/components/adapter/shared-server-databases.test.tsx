/**
 * The databases of a provided server in its panel, each with its last backup, what is left today
 * and Back up now, a Running badge while its backup runs and a muted note where the provider allows
 * none. From seven databases on the list gets a search and the filter of the running ones.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { filterDatabases, SharedServerDatabases } from "@/components/adapter/shared-server-databases";
import type { SharedServerAccess } from "@/components/adapter/shared-server-actions";
import { provided, serverTerms, sharedBackup } from "./shared-database-fixtures";

vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "MMM d", timeFormat: "HH:mm" } } }) }));

const ALL: SharedServerAccess = { canBackUp: true, canRestore: true, canViewBackups: true, canDownload: true };
const handlers = { onRestore: vi.fn(), onDownload: vi.fn(), downloading: false, when: () => "Oct 17, 02:14" };

const SHOP = provided("acme_shop", { perDay: 4, usedToday: 2, active: null }, sharedBackup("b5", "acme_shop", "2026-10-17T02:14:00.000Z"));
const CRM = provided("acme_crm", null);
const TICKETS = provided("acme_tickets", { perDay: 4, usedToday: 1, active: { requestId: "req-1", state: "running" } });

const many = [SHOP, CRM, TICKETS, ...["blog", "wiki", "stats", "forms", "mail", "maps", "docs", "chat", "pay"].map((name) => provided(`acme_${name}`, { perDay: 4, usedToday: 0, active: null }))];

const renderList = (databases: ReturnType<typeof provided>[], access = ALL, onBackUp = vi.fn()) =>
    render(<SharedServerDatabases terms={serverTerms(databases)} access={access} starting={null} onBackUp={onBackUp} handlers={handlers} />);

const lineOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("the databases of a provided server in its panel", () => {
    it("show each database with what is left today, Back up now, Running or Back up now off", async () => {
        const onBackUp = vi.fn();
        renderList([SHOP, CRM, TICKETS], ALL, onBackUp);

        expect(lineOf("acme_shop")).toHaveTextContent("yours since Oct 1 · 392.9 MB");
        expect(lineOf("acme_shop")).toHaveTextContent("2 of 4 left today");
        expect(lineOf("acme_crm")).toHaveTextContent("none allowed");
        expect(lineOf("acme_crm")).toHaveTextContent("Back up now off");
        expect(lineOf("acme_tickets")).toHaveTextContent("1 of 4 used today");
        expect(within(lineOf("acme_tickets")).getByRole("status")).toHaveTextContent("Running");

        await userEvent.setup().click(within(lineOf("acme_shop")).getByRole("button", { name: "Back up now" }));
        expect(onBackUp).toHaveBeenCalledWith(SHOP.database);
        // A short list needs no search.
        expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("leave out Back up now for a viewer who may not run a job, and the menu for one who may neither restore nor download", () => {
        renderList([SHOP, CRM], { canBackUp: false, canRestore: false, canViewBackups: true, canDownload: false });

        expect(screen.queryByRole("button", { name: "Back up now" })).toBeNull();
        expect(screen.queryByText("Back up now off")).toBeNull();
        expect(screen.queryByRole("button", { name: /Open menu/ })).toBeNull();
    });

    it("get a search and the filter of the running ones from seven databases on", async () => {
        renderList(many);
        const user = userEvent.setup();

        expect(screen.getByPlaceholderText("Search your 12 databases")).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Filter the databases" })).toHaveTextContent("All12Running1");
        expect(screen.getAllByRole("listitem")).toHaveLength(12);

        await user.type(screen.getByRole("textbox", { name: "Search your databases" }), "wi");
        expect(screen.getAllByRole("listitem").map((item) => within(item).getAllByText(/^acme_/)[0].textContent)).toEqual(["acme_wiki"]);

        await user.clear(screen.getByRole("textbox", { name: "Search your databases" }));
        await user.click(screen.getByRole("button", { name: /Running/ }));
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(screen.getByText("acme_tickets")).toBeInTheDocument();
    });

    it("filter by a part of the name and by whether a backup runs", () => {
        expect(filterDatabases(many, "SHOP", "all").map((entry) => entry.database.databaseName)).toEqual(["acme_shop"]);
        expect(filterDatabases(many, "", "running").map((entry) => entry.database.databaseName)).toEqual(["acme_tickets"]);
        expect(filterDatabases(many, "nothing", "all")).toEqual([]);
    });
});
