import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiTriggerDialog } from "@/components/dashboard/jobs/api-trigger-dialog";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const actions = vi.hoisted(() => ({ createApiKey: vi.fn() }));
vi.mock("@/app/actions/auth/api-key", () => actions);

function renderDialog(permissions: string[] = [PERMISSIONS.API_KEYS.READ, PERMISSIONS.API_KEYS.WRITE]) {
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
        const form = await screen.findByRole("dialog", { name: "Create API Key" });
        expect(within(form).getByLabelText("Name")).toHaveValue("API trigger for Shop nightly");
        expect(within(form).getByRole("checkbox", { name: "Execute Jobs Manually" })).toBeChecked();
        expect(within(form).getByRole("checkbox", { name: "View Execution History" })).toBeChecked();
        await user.click(within(form).getByRole("button", { name: "Create Key" }));

        await waitFor(() =>
            expect(actions.createApiKey).toHaveBeenCalledWith({ name: "API trigger for Shop nightly", permissions: ["jobs:execute", "history:read"], expiresAt: null }),
        );
        expect(await screen.findByText("Key API trigger for Shop nightly created")).toBeInTheDocument();
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
