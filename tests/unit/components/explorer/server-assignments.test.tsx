import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SourceAssignments } from "@/services/tenant/database-assignments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard/explorer/server" }));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
    getSourceAssignments: vi.fn(),
    assignDatabases: vi.fn(),
    addAssignmentRule: vi.fn(),
    removeAssignmentRule: vi.fn(),
    getMoveTargets: vi.fn(),
    moveSharedDatabase: vi.fn(),
    setDatabaseOnDemand: vi.fn(),
    setRuleOnDemand: vi.fn(),
}));
vi.mock("@/app/actions/tenant/database-assignments", () => actions);

import { ServerAssignments } from "@/components/dashboard/explorer/server-assignments";

// cmdk scrolls the highlighted row into view, which jsdom does not implement.
Element.prototype.scrollIntoView = vi.fn();

const acme = { id: "t-acme", name: "Acme" };
const beta = { id: "t-beta", name: "Beta" };

function data(overrides: Partial<SourceAssignments> = {}): SourceAssignments {
    return {
        databases: [
            { name: "crm", sizeInBytes: 2048, owner: null, backups: 4 },
            { name: "shop_a", sizeInBytes: 1024, owner: { tenantId: acme.id, tenantName: acme.name, via: "rule", since: "2026-10-01T00:00:00.000Z", onDemandPerDay: null, tenantOnDemand: null }, backups: 15 },
            { name: "shop_b", sizeInBytes: null, owner: { tenantId: beta.id, tenantName: beta.name, via: "assignment", since: "2026-10-05T00:00:00.000Z", onDemandPerDay: 3, tenantOnDemand: null }, backups: 30 },
        ],
        assignments: [
            { id: "a-2", databaseName: "shop_b", tenantId: beta.id, tenantName: beta.name, validFrom: "2026-10-05T00:00:00.000Z", validUntil: null, createdAt: "2026-10-05T00:00:00.000Z", byName: "Manu", movedTo: null, movedFrom: null, onDemandPerDay: 3 },
            { id: "a-1", databaseName: "shop_b", tenantId: acme.id, tenantName: acme.name, validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2026-10-05T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", byName: "Manu", movedTo: null, movedFrom: null, onDemandPerDay: null },
        ],
        rules: [{ id: "r-shop", pattern: "shop_*", tenantId: acme.id, tenantName: acme.name, priority: 0, validFrom: "2026-10-01T00:00:00.000Z", validUntil: null, createdAt: "2026-10-01T00:00:00.000Z", onDemandPerDay: null, tenantOnDemand: null }],
        customers: [acme, beta],
        tenants: [acme, beta],
        backupDates: { shop_b: ["2026-09-10T02:00:00.000Z", "2026-10-10T02:00:00.000Z"] },
        ...overrides,
    };
}

const card = (canAssign = true) => render(<ServerAssignments serverId="s1" serverName="Shop cluster" tenantName="Platform" canAssign={canAssign} />);

/** The row of a database in the table of the tenants. */
const rowOf = async (name: string) => {
    const table = await screen.findByRole("region", { name: "Databases and tenants" });
    return (await within(table).findByText(name)).closest("tr")!;
};

describe("the databases of a shared server and their tenants", () => {
    beforeEach(() => {
        for (const action of Object.values(actions)) action.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
        actions.getSourceAssignments.mockResolvedValue({ success: true, data: data() });
    });

    it("lists each database with its tenant, how it holds it and its backups, the rules beside, and offers no change without the right", async () => {
        card(false);

        const shopB = await rowOf("shop_b");
        expect(within(shopB).getByText("Beta")).toBeInTheDocument();
        expect(within(shopB).getByText("By name")).toBeInTheDocument();
        expect(within(shopB).getByText(/by Manu/)).toBeInTheDocument();
        expect(within(shopB).getByText("30")).toBeInTheDocument();
        expect(within(await rowOf("crm")).getByText("Only Platform")).toBeInTheDocument();

        const rules = screen.getByRole("region", { name: "Rules" });
        expect(within(rules).getByText("shop_*")).toBeInTheDocument();
        expect(within(rules).getByText("Gives now")).toBeInTheDocument();
        expect(within(rules).queryByRole("button", { name: "New rule" })).not.toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Who sees crm" })).not.toBeInTheDocument();
    });

    it("stays out while there is no other tenant to give a database to", async () => {
        actions.getSourceAssignments.mockResolvedValue({ success: true, data: data({ customers: [], tenants: [] }) });
        card();

        await waitFor(() => expect(actions.getSourceAssignments).toHaveBeenCalledWith("s1"));
        await waitFor(() => expect(screen.queryByRole("region", { name: "Shared with tenants" })).not.toBeInTheDocument());
    });

    it("gives a database to a tenant right in its row, from now on, and loads the cards again", async () => {
        const user = userEvent.setup();
        actions.assignDatabases.mockResolvedValue({ success: true, data: { changed: 1 } });
        card();

        await user.click(await screen.findByRole("combobox", { name: "Who sees crm" }));
        // Each tenant says what it holds of the server, Acme also what it held before.
        expect(await screen.findByText("Has shop_a of this server · held shop_b Sep 1 to Oct 5")).toBeInTheDocument();
        await user.click(await screen.findByRole("option", { name: /Acme/ }));

        await waitFor(() => expect(actions.assignDatabases).toHaveBeenCalledWith("s1", [{ databaseName: "crm", tenantId: acme.id }]));
        expect(toast.success).toHaveBeenCalledWith("crm belongs to Acme now", { description: "Its backups from now on show there." });
        await waitFor(() => expect(actions.getSourceAssignments).toHaveBeenCalledTimes(2));
    });

    it("takes a database back, the one a rule gives as well", async () => {
        const user = userEvent.setup();
        actions.assignDatabases.mockResolvedValue({ success: true, data: { changed: 1 } });
        card();

        await user.click(await screen.findByRole("combobox", { name: "Who sees shop_a" }));
        expect(await screen.findByText(/Nobody else takes it back from the rule/)).toBeInTheDocument();
        await user.click(await screen.findByRole("option", { name: /Nobody else/ }));
        await waitFor(() => expect(actions.assignDatabases).toHaveBeenCalledWith("s1", [{ databaseName: "shop_a", tenantId: null }]));
        actions.assignDatabases.mockClear();

        await user.click(screen.getByRole("combobox", { name: "Who sees shop_b" }));
        await user.click(await screen.findByRole("option", { name: /Nobody else/ }));
        await waitFor(() => expect(actions.assignDatabases).toHaveBeenCalledWith("s1", [{ databaseName: "shop_b", tenantId: null }]));
        expect(toast.success).toHaveBeenCalledWith("shop_b belongs to nobody else now", { description: "Beta keeps its backups from before." });
    });

    it("gives several picked databases to one tenant at once", async () => {
        const user = userEvent.setup();
        actions.assignDatabases.mockResolvedValue({ success: true, data: { changed: 2 } });
        card();

        await user.click(within(await rowOf("crm")).getByRole("checkbox"));
        await user.click(within(await rowOf("shop_a")).getByRole("checkbox"));
        await user.click(await screen.findByRole("button", { name: "Give to tenant" }));

        const dialog = await screen.findByRole("dialog", { name: "Give 2 databases to a tenant" });
        await user.click(within(dialog).getByRole("radio", { name: /Beta/ }));
        expect(within(dialog).getByText("Beta then holds 3 databases of this server.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Give 2 to Beta" }));

        await waitFor(() => expect(actions.assignDatabases).toHaveBeenCalledWith("s1", [
            { databaseName: "crm", tenantId: beta.id },
            { databaseName: "shop_a", tenantId: beta.id },
        ]));
    });

    it("asks before a rule goes and names what the tenant loses", async () => {
        const user = userEvent.setup();
        actions.removeAssignmentRule.mockResolvedValue({ success: true });
        card();

        await user.click(await screen.findByRole("button", { name: "Open menu for the rule shop_*" }));
        await user.click(await screen.findByRole("menuitem", { name: /Remove rule/ }));
        const dialog = await screen.findByRole("alertdialog", { name: "Remove the rule shop_*?" });
        expect(within(dialog).getByText("shop_a")).toBeInTheDocument();
        expect(within(dialog).getByText("goes to nobody else")).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Remove rule" }));
        await waitFor(() => expect(actions.removeAssignmentRule).toHaveBeenCalledWith("s1", "r-shop"));
    });

    it("adds a rule in the panel and shows what it would give while the pattern is typed", async () => {
        const user = userEvent.setup();
        actions.addAssignmentRule.mockResolvedValue({ success: true, data: { id: "r-new", pattern: "*", tenantId: beta.id, tenantName: beta.name, priority: 0, validFrom: "2026-10-15T00:00:00.000Z", validUntil: null, createdAt: "2026-10-15T00:00:00.000Z" } });
        card();

        await user.click(await screen.findByRole("button", { name: "New rule" }));
        const form = await screen.findByRole("form", { name: "New rule" });
        await user.type(within(form).getByLabelText("Pattern"), "*");
        await user.click(within(form).getByRole("combobox", { name: "Tenant" }));
        await user.click(await screen.findByRole("option", { name: /Beta/ }));

        expect(within(form).getByText("stays with Acme, rule shop_* ranks higher")).toBeInTheDocument();
        expect(within(form).getByText("stays with Beta, assigned by name")).toBeInTheDocument();
        expect(within(form).getByText("From now")).toBeInTheDocument();

        await user.click(within(form).getByRole("button", { name: "Add rule" }));
        await waitFor(() => expect(actions.addAssignmentRule).toHaveBeenCalledWith("s1", { pattern: "*", tenantId: beta.id, priority: 0 }));
    });

    it("shows who held a database when, with the backups kept of that time", async () => {
        const user = userEvent.setup();
        card();

        const timeline = await screen.findByRole("region", { name: "Who held each database" });
        await user.click(within(timeline).getByRole("button", { name: "shop_b: Acme · by name, Manu" }));
        const detail = await within(timeline).findByRole("region", { name: "shop_b with Acme" });
        expect(within(detail).getByText(/Beta got it by name/)).toBeInTheDocument();
        expect(within(detail).getByText(/1 backup still kept/)).toBeInTheDocument();
    });

    it("switches backups on demand of a database given by name off here, and shows how many a day in its row and where from", async () => {
        const user = userEvent.setup();
        actions.setDatabaseOnDemand.mockResolvedValue({ success: true });
        card();
        const row = await rowOf("shop_b");
        expect(within(row).getByText(/Backups on demand, 3 a day/)).toBeInTheDocument();
        expect(within(row).getByText(/set here/)).toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Open menu for shop_b" }));
        await user.click(await screen.findByRole("menuitem", { name: "Backups on demand" }));

        const dialog = await screen.findByRole("dialog", { name: "Backups on demand" });
        expect(within(dialog).getByRole("radio", { name: /A number of its own/ })).toBeChecked();
        await user.click(within(dialog).getByRole("radio", { name: /Off for shop_b/ }));
        await user.click(within(dialog).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(actions.setDatabaseOnDemand).toHaveBeenCalledWith("s1", "shop_b", 0));
        expect(toast.success).toHaveBeenCalledWith("Backups on demand are off for shop_b");
    });

    it("lets a database follow the number of its tenant again", async () => {
        const user = userEvent.setup();
        actions.setDatabaseOnDemand.mockResolvedValue({ success: true });
        card();
        await user.click(within(await rowOf("shop_b")).getByRole("button", { name: "Open menu for shop_b" }));
        await user.click(await screen.findByRole("menuitem", { name: "Backups on demand" }));

        const dialog = await screen.findByRole("dialog", { name: "Backups on demand" });
        await user.click(within(dialog).getByRole("radio", { name: /As Beta, none/ }));
        await user.click(within(dialog).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(actions.setDatabaseOnDemand).toHaveBeenCalledWith("s1", "shop_b", null));
        expect(toast.success).toHaveBeenCalledWith("shop_b follows Beta again");
    });

    describe("for someone of a platform group that reaches Acme alone", () => {
        // The server lists every tenant for the names, and only Acme among those to give to.
        const limited = () => data({
            customers: [acme],
            databases: [
                ...data().databases,
                { name: "beta_db", sizeInBytes: 512, owner: { tenantId: beta.id, tenantName: beta.name, via: "rule", since: "2026-10-01T00:00:00.000Z", onDemandPerDay: null, tenantOnDemand: null }, backups: 2 },
            ],
            rules: [
                ...data().rules,
                { id: "r-beta", pattern: "beta_*", tenantId: beta.id, tenantName: beta.name, priority: 0, validFrom: "2026-10-01T00:00:00.000Z", validUntil: null, createdAt: "2026-10-01T00:00:00.000Z", onDemandPerDay: null, tenantOnDemand: null },
            ],
        });

        beforeEach(() => {
            actions.getSourceAssignments.mockResolvedValue({ success: true, data: limited() });
        });

        it("offers only the tenants it reaches in the picker of a database", async () => {
            const user = userEvent.setup();
            card();

            await user.click(await screen.findByRole("combobox", { name: "Who sees crm" }));
            expect(await screen.findByRole("option", { name: /Acme/ })).toBeInTheDocument();
            expect(screen.queryByRole("option", { name: /Beta/ })).not.toBeInTheDocument();
        });

        it("leaves a database of a tenant it does not reach as it is, and says why", async () => {
            const user = userEvent.setup();
            card();

            const shopB = await rowOf("shop_b");
            expect(within(shopB).queryByRole("combobox", { name: "Who sees shop_b" })).not.toBeInTheDocument();
            expect(within(shopB).getByText("shop_b belongs to Beta, which your platform group does not reach, so you cannot change it.")).toBeInTheDocument();
            await user.click(within(shopB).getByRole("button", { name: "Open menu for shop_b" }));
            expect(await screen.findByRole("menuitem", { name: "Who held it" })).toBeInTheDocument();
            expect(screen.queryByRole("menuitem", { name: "Move to another server" })).not.toBeInTheDocument();
            expect(screen.queryByRole("menuitem", { name: "Backups on demand" })).not.toBeInTheDocument();
            expect(screen.queryByRole("menuitem", { name: "Take back" })).not.toBeInTheDocument();
        });

        it("offers no change of a rule of a tenant it does not reach, and no new rule that would outrank one", async () => {
            const user = userEvent.setup();
            card();

            const rules = await screen.findByRole("region", { name: "Rules" });
            expect(within(rules).getByRole("button", { name: "Open menu for the rule shop_*" })).toBeInTheDocument();
            expect(within(rules).queryByRole("button", { name: "Open menu for the rule beta_*" })).not.toBeInTheDocument();

            await user.click(within(rules).getByRole("button", { name: "New rule" }));
            const form = await screen.findByRole("form", { name: "New rule" });
            await user.type(within(form).getByLabelText("Pattern"), "beta_*");
            await user.click(within(form).getByRole("button", { name: "Higher priority" }));
            expect(within(form).getByText("The rule would take beta_db from Beta, which your platform group does not reach. Give it a lower priority or a narrower pattern.")).toBeInTheDocument();
            expect(within(form).getByRole("button", { name: "Add rule" })).toBeDisabled();
        });
    });

    it("moves a database a tenant holds to another server of the same engine", async () => {
        const user = userEvent.setup();
        actions.getMoveTargets.mockResolvedValue({ success: true, data: [{ id: "s2", name: "New cluster", databases: ["shop_b", "wiki"] }] });
        actions.moveSharedDatabase.mockResolvedValue({ success: true, data: { tenantName: "Beta", toServerName: "New cluster", toDatabase: "shop_new" } });
        card();
        expect(within(await rowOf("crm")).queryByRole("button", { name: "Open menu for crm" })).toBeInTheDocument();
        await user.click(within(await rowOf("shop_b")).getByRole("button", { name: "Open menu for shop_b" }));
        await user.click(await screen.findByRole("menuitem", { name: "Move to another server" }));

        const dialog = await screen.findByRole("dialog", { name: "Move shop_b to another server" });
        const name = await within(dialog).findByLabelText("Name there");
        await user.clear(name);
        await user.type(name, "shop_new");
        expect(within(dialog).getByText("New cluster does not list shop_new yet, the move counts all the same.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Move shop_b" }));
        await waitFor(() => expect(actions.moveSharedDatabase).toHaveBeenCalledWith("s1", { databaseName: "shop_b", toSourceId: "s2", toDatabase: "shop_new" }));
        expect(toast.success).toHaveBeenCalledWith("shop_b moved to New cluster", { description: "Beta keeps its backups and restores them into shop_new there." });
    });
});
