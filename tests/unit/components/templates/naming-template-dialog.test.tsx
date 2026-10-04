import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NamingTemplateDialog } from "@/components/settings/templates/naming-template-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({ createNamingTemplate: vi.fn(), updateNamingTemplate: vi.fn() }));
vi.mock("@/app/actions/templates", () => actions);

function renderDialog(props: Partial<React.ComponentProps<typeof NamingTemplateDialog>> = {}) {
    const onSuccess = vi.fn();
    render(<NamingTemplateDialog open onOpenChange={vi.fn()} onSuccess={onSuccess} {...props} />);
    return onSuccess;
}

describe("naming template dialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ schedulerTimezone: "UTC" }) } as Response)) as unknown as typeof fetch;
    });

    it("previews a name the way a backup is written, as a .tar", async () => {
        renderDialog();

        expect(await screen.findByText(/^Shop_nightly_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar$/)).toBeInTheDocument();
        expect(screen.getByText("A job called Shop nightly, times in UTC")).toBeInTheDocument();
    });

    it("warns when a pattern without the time lets two backups of a day share a name", async () => {
        const user = userEvent.setup();
        renderDialog();

        const pattern = screen.getByLabelText("Pattern");
        await user.clear(pattern);
        await user.type(pattern, "{{job_name}_yyyy-MM-dd");

        expect(screen.getByRole("status")).toHaveTextContent("Without the time of day, the backups of a job on one day get the same name");
    });

    it("makes a template from its name and pattern", async () => {
        const user = userEvent.setup();
        const made = { id: "tpl-new", name: "Date and time", description: "", pattern: "{job_name}_yyyy-MM-dd_HH-mm-ss", isDefault: false, isSystem: false };
        actions.createNamingTemplate.mockResolvedValue({ success: true, data: made });
        const onSuccess = renderDialog();

        await user.type(screen.getByLabelText("Name"), "Date and time");
        await user.click(screen.getByRole("button", { name: "Create template" }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(made));
        expect(actions.createNamingTemplate).toHaveBeenCalledWith({ name: "Date and time", description: "", pattern: "{job_name}_yyyy-MM-dd_HH-mm-ss" });
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("asks for a name before it saves", async () => {
        const user = userEvent.setup();
        renderDialog();

        await user.click(screen.getByRole("button", { name: "Create template" }));

        expect(screen.getByText("Give the template a name.")).toBeInTheDocument();
        expect(actions.createNamingTemplate).not.toHaveBeenCalled();
    });
});
