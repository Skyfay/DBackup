import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { ConnectionForm } from "@/components/adapter/connection-form";

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

function adapter(id: string): AdapterDefinition {
    const definition = getAdapterDefinition(id);
    if (!definition) throw new Error(`No adapter ${id}`);
    return definition;
}

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

const mockFetch = vi.fn((url: string, _init?: RequestInit) => {
    if (url.startsWith("/api/credentials")) return json({ success: true, data: [] });
    if (url === "/api/adapters/test-connection") return json({ success: false, message: "Access denied for user 'backup'" });
    if (url === "/api/adapters") return json({ success: true, id: "new-id" });
    return json({ success: false, error: `Unexpected ${url}` }, false);
});

function renderForm(id: string, onSaved = vi.fn()) {
    render(
        <Dialog open>
            <DialogContent>
                <ConnectionForm adapter={adapter(id)} title="Add database" onSaved={onSaved} />
            </DialogContent>
        </Dialog>
    );
    return onSaved;
}

const requested = (url: string) => mockFetch.mock.calls.some(([called]) => called === url);

describe("connection form", () => {
    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    it("opens the part with the missing field when Create finds one, instead of doing nothing", async () => {
        const user = userEvent.setup();
        renderForm("firebird");

        await user.type(screen.getByLabelText("Name"), "ERP");
        await user.click(screen.getByRole("radio", { name: /Direct/ }));
        await user.click(screen.getByRole("button", { name: "Create database" }));

        const aliases = await screen.findByRole("tab", { name: /Aliases/ });
        await waitFor(() => expect(aliases).toHaveAttribute("aria-selected", "true"));
        expect(screen.getByRole("tabpanel", { name: /Aliases/ })).toHaveTextContent("At least one database alias is required");
        // The rail counts the problem, so the part stays findable after moving away.
        expect(aliases).toHaveTextContent("1 field needs attention");
        expect(requested("/api/adapters/test-connection")).toBe(false);
    });

    it("asks for the connection mode before showing the fields that depend on it", async () => {
        const user = userEvent.setup();
        renderForm("mysql");

        expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
        await user.type(screen.getByLabelText("Name"), "Shop");
        await user.click(screen.getByRole("button", { name: "Create database" }));

        expect(await screen.findByText("Choose how DBackup connects.")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Connection/ })).toHaveAttribute("aria-selected", "true");
    });

    it("starts a Redis source on its default setup instead of an empty choice", () => {
        renderForm("redis");
        const options = screen.getByRole("tabpanel", { name: /Options/ });
        expect(within(options).getByRole("combobox", { name: "Redis setup" })).toHaveTextContent("standalone");
    });

    it("asks before saving a database whose connection test fails, and saves once confirmed", async () => {
        const user = userEvent.setup();
        const onSaved = renderForm("postgres");

        await user.type(screen.getByLabelText("Name"), "Shop");
        await user.click(screen.getByRole("radio", { name: /Direct/ }));
        await user.click(screen.getByRole("button", { name: "Create database" }));

        expect(await screen.findByText("Save without a working connection?")).toBeInTheDocument();
        expect(screen.getByText("Access denied for user 'backup'")).toBeInTheDocument();
        expect(requested("/api/adapters")).toBe(false);

        await user.click(screen.getByRole("button", { name: "Save anyway" }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());

        const [, init] = mockFetch.mock.calls.find(([url]) => url === "/api/adapters")!;
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ name: "Shop", adapterId: "postgres", type: "database", config: { connectionMode: "direct", port: 5432 } });
        // Health alerts and the restore target are on by default, stored the way the API reads them.
        expect(body.metadata).toEqual({ healthNotificationsDisabled: false, isRestoreExcluded: false });
    });
});
