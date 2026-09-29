import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiTriggerDialog } from "@/components/dashboard/jobs/api-trigger-dialog";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

const actions = vi.hoisted(() => ({ createApiKey: vi.fn(), updateApiKey: vi.fn() }));
vi.mock("@/app/actions/auth/api-key", () => actions);

const WITH_KEYS = [PERMISSIONS.API_KEYS.READ, PERMISSIONS.API_KEYS.WRITE, PERMISSIONS.JOBS.EXECUTE, PERMISSIONS.HISTORY.READ];

function renderDialog(permissions: string[] = WITH_KEYS) {
    render(
        <PermissionsProvider permissions={permissions}>
            <ApiTriggerDialog jobId="job-42" jobName="Shop nightly" open onOpenChange={vi.fn()} />
        </PermissionsProvider>,
    );
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("API trigger dialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        actions.createApiKey.mockResolvedValue({ success: true, data: { apiKey: { id: "key-1" }, rawKey: "dbackup_made_in_setup" } });
        // The keys there are, so the name of the new one stays free.
        vi.stubGlobal("fetch", vi.fn(async (url: string) =>
            url === "/api/api-keys"
                ? new Response(JSON.stringify({ success: true, data: { keys: [], stats: {}, viewer: { id: "u1", superAdmin: false, permissions: WITH_KEYS } } }))
                : new Response(JSON.stringify({ success: false }), { status: 404 }),
        ));
    });

    it("lists Overview and Setup first, then the scripts and the pipelines", () => {
        renderDialog();

        const names = within(screen.getByRole("tablist", { name: "Parts of the dialog" })).getAllByRole("tab").map((entry) => entry.textContent);
        expect(names).toEqual(["Overview", "Setup", "cURL", "Bash", "Python", "TypeScript", "Go", "GitHub Actions", "GitLab CI", "Azure DevOps", "Ansible"]);
        expect(screen.getByText(`${window.location.origin}/api/jobs/job-42/run`)).toBeInTheDocument();
    });

    it("makes a key with both rights in Setup and fills it into cURL and every other example", async () => {
        const user = userEvent.setup();
        renderDialog();

        await user.click(tab(/^Setup/));
        await user.click(screen.getByRole("button", { name: "Create key" }));
        // The editor of New API key opens on the task of a CI/CD pipeline, without the first step.
        const form = await screen.findByRole("dialog", { name: "New API key" });
        expect(within(form).getByLabelText("Name")).toHaveValue("API trigger for Shop nightly");
        expect(within(form).getByText(/^2 of \d+ permissions · runs out/)).toBeInTheDocument();
        expect(within(form).queryByRole("button", { name: "Change task" })).not.toBeInTheDocument();
        await user.click(within(form).getByRole("button", { name: "Create key" }));

        await waitFor(() =>
            expect(actions.createApiKey).toHaveBeenCalledWith({
                name: "API trigger for Shop nightly",
                permissions: ["jobs:execute", "history:read"],
                expiresAt: expect.any(String),
                template: "ci",
            }),
        );
        expect(await screen.findByText("Key API trigger for Shop nightly created")).toBeInTheDocument();
        expect(screen.getByText("Sees the history. Runs jobs. Changes nothing.")).toBeInTheDocument();
        // The key itself, and in the cURL of the second step.
        expect(screen.getAllByText("dbackup_made_in_setup").length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByText("dbackup_YOUR_API_KEY")).not.toBeInTheDocument();

        await user.click(tab(/^Python/));
        expect(screen.getByText("dbackup_made_in_setup")).toBeInTheDocument();
        expect(screen.getByText("The new key is gone once this dialog closes")).toBeInTheDocument();
    });

    it("leaves Create key out for a user who may not write API keys, and the link for one who may not read them", async () => {
        const user = userEvent.setup();
        renderDialog([]);

        await user.click(tab(/^Setup/));

        expect(screen.queryByRole("button", { name: "Create key" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
        expect(screen.getAllByText("dbackup_YOUR_API_KEY").length).toBeGreaterThan(0);
    });

    it("shows a pipeline with the secrets it reads, the key among them", async () => {
        const user = userEvent.setup();
        renderDialog();

        await user.click(tab(/^GitHub Actions/));

        expect(screen.getByText(".github/workflows/backup.yml")).toBeInTheDocument();
        expect(screen.getByText("DBACKUP_API_KEY", { selector: "span.w-32" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy the key" })).toBeInTheDocument();
    });
});
