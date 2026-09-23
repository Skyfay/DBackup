import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import type { SavedConnection } from "@/components/adapter/use-connection-form";
import { SetupWizard } from "@/components/dashboard/setup/setup-wizard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

const createEncryptionProfile = vi.fn();
vi.mock("@/app/actions/backup/encryption", () => ({
    createEncryptionProfile: (...args: unknown[]) => createEncryptionProfile(...args),
}));

// The form of the Connections page has tests of its own. Here it only has to save or go back.
vi.mock("@/components/adapter/connection-form", () => ({
    ConnectionForm: ({ adapter, step, lockRole, onBack, onSaved }: {
        adapter: AdapterDefinition;
        step: string;
        lockRole?: boolean;
        onBack: () => void;
        onSaved: (saved: SavedConnection) => void;
    }) => (
        <div>
            <p>{`Form for ${adapter.name} · ${step}${lockRole ? " · role locked" : ""}`}</p>
            <button type="button" onClick={onBack}>Change type</button>
            <button type="button" onClick={() => onSaved({ id: `${adapter.id}-1`, name: `My ${adapter.name}`, adapterId: adapter.id })}>Save connection</button>
        </div>
    ),
}));

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

let databases: unknown[] = [];
const mockFetch = vi.fn((url: string, _init?: RequestInit) => {
    if (url === "/api/system/timezone") return json({ schedulerTimezone: "UTC" });
    if (url === "/api/adapters?type=database") return json(databases);
    if (url.startsWith("/api/adapters?type=")) return json([]);
    if (url === "/api/adapters/mysql-1/databases") return json({ success: true, databases: ["shop", "billing"] });
    if (url === "/api/jobs") return json({ id: "job-1", name: "My MySQL backup" });
    if (url === "/api/jobs/job-1/run") return json({ success: true });
    return json({ error: `Unexpected ${url}` }, false);
});

const posted = (url: string) => {
    const call = mockFetch.mock.calls.find(([called, init]) => called === url && init?.method === "POST");
    return call ? JSON.parse(String(call[1]?.body ?? "{}")) : undefined;
};

function renderWizard(rights: { vault?: boolean; notification?: boolean } = {}) {
    render(
        <SetupWizard
            canCreateVault={rights.vault ?? true}
            canCreateNotification={rights.notification ?? true}
            canRunJob
            canOpenVault
            keys={[]}
        />
    );
}

const rail = () => within(screen.getByRole("navigation", { name: "Setup steps" }));

describe("quick setup", () => {
    beforeEach(() => {
        databases = [];
        mockFetch.mockClear();
        push.mockClear();
        createEncryptionProfile.mockReset().mockResolvedValue({ success: true, data: { id: "key-1" } });
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    it("walks from the database to the finished job, with each part named on the left", async () => {
        const user = userEvent.setup();
        renderWizard();

        expect(screen.getByText("What do you want to back up? · Step 1 of 5")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /^MySQL/ }));
        expect(screen.getByText("Form for MySQL · Step 1 of 5")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save connection" }));

        // Saving moves on without a screen in between, and the rail shows what was made.
        expect(screen.getByText("Where should the backups go? · Step 2 of 5")).toBeInTheDocument();
        expect(rail().getByRole("button", { name: /Database.*My MySQL · MySQL.*done/ })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /^Local Filesystem/ }));
        // A storage connection added here is a destination, so the form does not ask.
        expect(screen.getByText("Form for Local Filesystem · Step 2 of 5 · role locked")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save connection" }));

        await user.click(screen.getByRole("button", { name: "Create key" }));
        expect(createEncryptionProfile).toHaveBeenCalledWith("Backup key");
        await user.click(await screen.findByRole("button", { name: "Skip" }));

        expect(rail().getByRole("button", { name: /Notifications.*Skipped/ })).toBeInTheDocument();
        expect(screen.getByLabelText("Name")).toHaveValue("My MySQL backup");
        // The cards say when the scheduler fires, in the time zone and the time format of the user.
        expect(screen.getByRole("radio", { name: /Every night/ })).toBeChecked();
        expect(screen.getByText("At 03:00")).toBeInTheDocument();
        expect(screen.getByText("Sunday at 03:00")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Some databases/ }));
        await user.click(await screen.findByRole("checkbox", { name: "shop" }));
        await user.click(screen.getByRole("button", { name: "Create backup job" }));

        expect(await screen.findByText("Your first backup is set up")).toBeInTheDocument();
        expect(posted("/api/jobs")).toMatchObject({
            name: "My MySQL backup",
            schedule: "0 3 * * *",
            sourceId: "mysql-1",
            databases: ["shop"],
            destinations: [{ configId: "local-filesystem-1" }],
            encryptionProfileId: "key-1",
            notificationIds: [],
        });
        expect(screen.getByText(/^The first run starts \d{4}-\d{2}-\d{2} 03:00\./)).toBeInTheDocument();
        // Once the job exists, the steps can no longer be opened again.
        expect(rail().getByRole("button", { name: /Database/ })).toBeDisabled();

        await user.click(screen.getByRole("button", { name: "Run it now" }));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/history"));
        expect(posted("/api/jobs/job-1/run")).toEqual({});
    });

    it("takes a connection that exists instead of a new one, and offers it again on the way back", async () => {
        databases = [{ id: "db-9", name: "CRM", adapterId: "postgres", type: "database", config: JSON.stringify({ host: "db01.internal", port: 5432 }) }];
        const user = userEvent.setup();
        renderWizard({ vault: false, notification: false });

        await user.click(await screen.findByRole("button", { name: "Use existing" }));
        expect(screen.getByText("Pick one you already have · Step 1 of 3")).toBeInTheDocument();
        const use = screen.getByRole("button", { name: "Use this database" });
        expect(use).toBeDisabled();
        await user.click(screen.getByRole("radio", { name: /CRM.*PostgreSQL · db01\.internal:5432/ }));
        await user.click(use);

        expect(rail().getByRole("button", { name: /Database.*CRM · PostgreSQL/ })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Back" }));
        expect(await screen.findByRole("radio", { name: /CRM/ })).toBeChecked();
    });

    it("keeps the job as typed while an earlier step is open, and refuses a schedule it cannot read", async () => {
        databases = [{ id: "db-9", name: "CRM", adapterId: "postgres", type: "database", config: "{}" }];
        const user = userEvent.setup();
        renderWizard({ vault: false, notification: false });

        await user.click(await screen.findByRole("button", { name: "Use existing" }));
        await user.click(screen.getByRole("radio", { name: /CRM/ }));
        await user.click(screen.getByRole("button", { name: "Use this database" }));
        await user.click(screen.getByRole("button", { name: /^Local Filesystem/ }));
        await user.click(screen.getByRole("button", { name: "Save connection" }));

        const name = screen.getByLabelText("Name");
        await user.clear(name);
        await user.type(name, "CRM nightly");
        await user.click(rail().getByRole("button", { name: /Backup destination/ }));
        await user.click(rail().getByRole("button", { name: /Backup job/ }));
        expect(screen.getByLabelText("Name")).toHaveValue("CRM nightly");

        await user.click(screen.getByRole("radio", { name: /Custom/ }));
        const cron = screen.getByLabelText("Cron expression");
        await user.clear(cron);
        await user.type(cron, "every night");
        await user.click(screen.getByRole("button", { name: "Create backup job" }));

        expect(await screen.findByText("Enter a cron expression with five parts, like 0 3 * * *.")).toBeInTheDocument();
        expect(posted("/api/jobs")).toBeUndefined();
    });
});
