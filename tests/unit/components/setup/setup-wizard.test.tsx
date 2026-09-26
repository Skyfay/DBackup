import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import type { SavedConnection } from "@/components/adapter/use-connection-form";
import { SetupWizard } from "@/components/dashboard/setup/setup-wizard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

const createEncryptionProfile = vi.fn();
vi.mock("@/app/actions/backup/encryption", () => ({
    createEncryptionProfile: (...args: unknown[]) => createEncryptionProfile(...args),
}));

// The form of the Connections page has tests of its own. Here it only has to save or go back.
vi.mock("@/components/adapter/connection-form", async () => {
    const { DialogDescription, DialogTitle } = await import("@/components/ui/dialog");
    return {
        ConnectionForm: ({ adapter, lockRole, onBack, onSaved }: {
            adapter: AdapterDefinition;
            lockRole?: boolean;
            onBack: () => void;
            onSaved: (saved: SavedConnection) => void;
        }) => (
            <div>
                <DialogTitle>{`Form for ${adapter.name}${lockRole ? " · role locked" : ""}`}</DialogTitle>
                <DialogDescription>The connection form</DialogDescription>
                <button type="button" onClick={onBack}>Change type</button>
                <button type="button" onClick={() => onSaved({ id: `${adapter.id}-1`, name: `My ${adapter.name}`, adapterId: adapter.id })}>Save connection</button>
            </div>
        ),
    };
});

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

let databases: unknown[] = [];
const mockFetch = vi.fn((url: string, _init?: RequestInit) => {
    if (url === "/api/system/timezone") return json({ schedulerTimezone: "UTC" });
    if (url === "/api/adapters?type=database") return json(databases);
    if (url.startsWith("/api/adapters?type=")) return json([]);
    if (url === "/api/adapters/mysql-1/databases") return json({ success: true, databases: ["shop", "billing"] });
    if (url === "/api/jobs") return json({ id: "job-1", name: "My MySQL backup" });
    if (url === "/api/jobs/job-1/run") return json({ success: true, executionId: "exec-1" });
    return json({ error: `Unexpected ${url}` }, false);
});

const posted = (url: string) => {
    const call = mockFetch.mock.calls.find(([called, init]) => called === url && init?.method === "POST");
    return call ? JSON.parse(String(call[1]?.body ?? "{}")) : undefined;
};

function renderWizard(rights: { vault?: boolean; notification?: boolean } = {}, keys: { id: string; name: string; detail: string }[] = []) {
    render(
        <SetupWizard
            canCreateVault={rights.vault ?? true}
            canCreateNotification={rights.notification ?? true}
            canRunJob
            canOpenVault
            keys={keys}
        />
    );
}

/** A part that is not open, found by its title. */
const part = (title: string) => within(screen.getByRole("region", { name: title }));
const preview = () => within(screen.getByRole("complementary", { name: "Your first backup" }));
const openPart = (question: string) => screen.getByRole("heading", { level: 2, name: question });

/** Takes the CRM database that exists, then adds a local destination. */
async function pickCrmAndLocal(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("radio", { name: /CRM/ }));
    await user.click(screen.getByRole("button", { name: "Use this database" }));
    await user.click(screen.getByRole("button", { name: /^Local Filesystem/ }));
    await user.click(screen.getByRole("button", { name: "Save connection" }));
}

describe("quick setup", () => {
    beforeEach(() => {
        databases = [];
        mockFetch.mockClear();
        push.mockClear();
        createEncryptionProfile.mockReset().mockResolvedValue({ success: true, data: { id: "key-1" } });
        global.fetch = mockFetch as unknown as typeof fetch;
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("walks from the database to the finished job, one part under the other", async () => {
        const user = userEvent.setup();
        renderWizard();

        expect(openPart("What do you want to back up?")).toBeInTheDocument();
        expect(part("Destination").getByText("Where the backups go")).toBeInTheDocument();
        expect(preview().getByText("What to back up")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /^MySQL/ }));
        expect(await screen.findByRole("dialog", { name: "Form for MySQL" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save connection" }));

        // Saving opens the next part without a screen in between, and the part before keeps what it made.
        expect(openPart("Where should the backups go?")).toBeInTheDocument();
        expect(part("Database").getByText("My MySQL · MySQL")).toBeInTheDocument();
        expect(preview().getByText("My MySQL · MySQL")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /^Local Filesystem/ }));
        // A storage connection added here is a destination, so the form does not ask.
        expect(await screen.findByRole("dialog", { name: "Form for Local Filesystem · role locked" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save connection" }));

        await user.click(screen.getByRole("button", { name: "Create key" }));
        expect(createEncryptionProfile).toHaveBeenCalledWith("Backup key");
        expect(openPart("Who hears about a run?")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Skip" }));

        expect(part("Notifications").getByText("Skipped, add one later")).toBeInTheDocument();
        expect(screen.getByLabelText("Name")).toHaveValue("My MySQL backup");
        // The cards say when the scheduler fires, in the time zone and the time format of the user.
        expect(screen.getByRole("radio", { name: /Every night/ })).toBeChecked();
        expect(screen.getByText("At 03:00")).toBeInTheDocument();
        expect(screen.getByText("Sunday at 03:00")).toBeInTheDocument();
        // The backup beside the parts follows the schedule while it is picked.
        expect(preview().getByText("Backed up every night")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Every week/ }));
        expect(preview().getByText("Backed up every week")).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Every night/ }));
        await user.click(screen.getByRole("radio", { name: /Some databases/ }));
        await user.click(await screen.findByRole("checkbox", { name: "shop" }));
        await user.click(screen.getByRole("button", { name: "Create the job" }));

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
        expect(part("Backup job").getByText("My MySQL backup · every night")).toBeInTheDocument();
        // Once the job exists, the parts can no longer be changed.
        expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();

        // Like Run now on the Overview, it opens the new run unless the user switched that off.
        await user.click(screen.getByRole("button", { name: "Run it now" }));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/history?executionId=exec-1"));
        expect(posted("/api/jobs/job-1/run")).toEqual({});
    });

    it("takes a connection that exists instead of a new one, and offers it again when the part is changed", async () => {
        databases = [{ id: "db-9", name: "CRM", adapterId: "postgres", type: "database", config: JSON.stringify({ host: "db01.internal", port: 5432 }) }];
        const user = userEvent.setup();
        renderWizard({ vault: false, notification: false });

        const use = screen.getByRole("button", { name: "Use this database" });
        expect(use).toBeDisabled();
        await user.click(await screen.findByRole("radio", { name: /CRM.*PostgreSQL · db01\.internal:5432/ }));
        await user.click(use);

        expect(part("Database").getByText("CRM · PostgreSQL")).toBeInTheDocument();
        expect(openPart("Where should the backups go?")).toBeInTheDocument();
        await user.click(part("Database").getByRole("button", { name: "Change" }));
        expect(await screen.findByRole("radio", { name: /CRM/ })).toBeChecked();
        // The part that was open waits below, and taking the database again goes back to it.
        expect(part("Destination").getByRole("button", { name: "Open" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Use this database" }));
        expect(openPart("Where should the backups go?")).toBeInTheDocument();
    });

    it("names a new key so it does not clash with one the Vault already holds, or takes that one", async () => {
        databases = [{ id: "db-9", name: "CRM", adapterId: "postgres", type: "database", config: "{}" }];
        const user = userEvent.setup();
        renderWizard({ notification: false }, [{ id: "key-9", name: "Backup key", detail: "" }]);

        await pickCrmAndLocal(user);

        expect(screen.getByLabelText("Name")).toHaveValue("Backup key 2");
        await user.click(screen.getByRole("radio", { name: /Backup key/ }));
        await user.click(screen.getByRole("button", { name: "Use this key" }));

        expect(part("Encryption").getByText("Backup key")).toBeInTheDocument();
        expect(createEncryptionProfile).not.toHaveBeenCalled();
    });

    it("keeps the job as typed while an earlier part is open, and refuses a schedule it cannot read", async () => {
        databases = [{ id: "db-9", name: "CRM", adapterId: "postgres", type: "database", config: "{}" }];
        const user = userEvent.setup();
        renderWizard({ vault: false, notification: false });

        await pickCrmAndLocal(user);

        const name = screen.getByLabelText("Name");
        await user.clear(name);
        await user.type(name, "CRM nightly");
        await user.click(part("Destination").getByRole("button", { name: "Change" }));
        await user.click(part("Backup job").getByRole("button", { name: "Open" }));
        expect(screen.getByLabelText("Name")).toHaveValue("CRM nightly");

        await user.click(screen.getByRole("radio", { name: /Custom/ }));
        const cron = screen.getByLabelText("Cron expression");
        await user.clear(cron);
        await user.type(cron, "every night");
        await user.click(screen.getByRole("button", { name: "Create the job" }));

        expect(await screen.findByText("Enter a cron expression with five parts, like 0 3 * * *.")).toBeInTheDocument();
        expect(posted("/api/jobs")).toBeUndefined();
    });
});
