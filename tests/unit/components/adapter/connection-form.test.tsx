import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
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

function renderForm(id: string, onSaved = vi.fn(), defaultRole?: StorageRole) {
    render(
        <Dialog open>
            <DialogContent>
                <ConnectionForm adapter={adapter(id)} defaultRole={defaultRole} onSaved={onSaved} />
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

    it("opens the location of a Hetzner destination when its required folder is missing", async () => {
        const user = userEvent.setup();
        renderForm("s3-hetzner", vi.fn(), STORAGE_ROLES.DESTINATION);

        await user.type(screen.getByLabelText("Name"), "Offsite");
        await user.type(screen.getByLabelText("Bucket"), "backups");
        await user.click(screen.getByRole("button", { name: "Create destination" }));

        const location = await screen.findByRole("tab", { name: /Location/ });
        await waitFor(() => expect(location).toHaveAttribute("aria-selected", "true"));
        expect(screen.getByRole("tabpanel", { name: /Location/ })).toHaveTextContent("Path prefix is required for Hetzner");
        expect(requested("/api/adapters")).toBe(false);
    });

    it("swaps the upload settings for parallel transfers when a destination becomes a directory source", async () => {
        const user = userEvent.setup();
        renderForm("s3-aws", vi.fn(), STORAGE_ROLES.DESTINATION);

        expect(screen.getByRole("tabpanel", { name: /Speed/ })).toHaveTextContent("Parts at once");
        await user.click(screen.getByRole("radio", { name: /Directory source/ }));

        expect(screen.getByRole("tabpanel", { name: /Speed/ })).toHaveTextContent("Parallel transfers");
        expect(screen.getByRole("button", { name: "Create source" })).toBeInTheDocument();
    });

    it("saves a storage connection with its role without testing it first", async () => {
        const user = userEvent.setup();
        const onSaved = renderForm("s3-aws", vi.fn(), STORAGE_ROLES.DESTINATION);

        await user.type(screen.getByLabelText("Name"), "Archive");
        await user.type(screen.getByLabelText("Region"), "eu-central-1");
        await user.type(screen.getByLabelText("Bucket"), "backups");
        await user.click(screen.getByRole("button", { name: "Create destination" }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());

        expect(requested("/api/adapters/test-connection")).toBe(false);
        const [, init] = mockFetch.mock.calls.find(([url]) => url === "/api/adapters")!;
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ type: "storage", storageRole: "DESTINATION", config: { region: "eu-central-1", bucket: "backups" } });
        // Integrity checks are on unless switched off, which the API reads as skipVerification.
        expect(body.metadata).toEqual({ healthNotificationsDisabled: false, skipVerification: false });
    });

    it("opens the message of an email channel when it has no recipient yet", async () => {
        const user = userEvent.setup();
        renderForm("email");

        await user.type(screen.getByLabelText("Name"), "Ops mail");
        await user.type(screen.getByLabelText("SMTP host"), "smtp.example.com");
        await user.type(screen.getByLabelText("From"), "backup@example.com");
        await user.click(screen.getByRole("button", { name: "Create channel" }));

        const message = await screen.findByRole("tab", { name: /Message/ });
        await waitFor(() => expect(message).toHaveAttribute("aria-selected", "true"));
        expect(screen.getByRole("tabpanel", { name: /Message/ })).toHaveTextContent("Add at least one recipient.");
        expect(requested("/api/adapters")).toBe(false);
    });

    it("gives a Teams channel no list of parts and saves it without sending a test first", async () => {
        const user = userEvent.setup();
        const onSaved = renderForm("teams");

        expect(screen.queryByRole("tab")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Send test" })).toBeInTheDocument();
        await user.type(screen.getByLabelText("Name"), "Ops channel");
        await user.click(screen.getByRole("button", { name: "Create channel" }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());

        expect(requested("/api/adapters/test-connection")).toBe(false);
        const [, init] = mockFetch.mock.calls.find(([url]) => url === "/api/adapters")!;
        expect(JSON.parse(String(init?.body))).toMatchObject({ name: "Ops channel", type: "notification", metadata: {} });
    });
});

