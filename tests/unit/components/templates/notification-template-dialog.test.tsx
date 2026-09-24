import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationTemplateDialog } from "@/components/settings/templates/notification-template-dialog";
import type { NotificationTemplateItem } from "@/components/templates/notification-model";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({ createNotificationTemplate: vi.fn(), updateNotificationTemplate: vi.fn() }));
vi.mock("@/app/actions/templates", () => actions);

const ADMINS = { id: "admins", name: "Admins", adapterId: "email" };
const OPS = { id: "ops", name: "#ops-alerts", adapterId: "slack" };

function renderDialog(props: Partial<React.ComponentProps<typeof NotificationTemplateDialog>> = {}) {
    const onSuccess = vi.fn();
    render(<NotificationTemplateDialog open onOpenChange={vi.fn()} channels={[ADMINS, OPS]} onSuccess={onSuccess} {...props} />);
    return onSuccess;
}

const runs = (row: number) => within(screen.getByRole("group", { name: `Runs channel ${row} hears about` }));

describe("notification template dialog", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => vi.clearAllMocks());

    it("makes a template of channels, each with the runs it hears about", async () => {
        const user = userEvent.setup();
        const made = { id: "tpl-new", name: "Ops alerts", description: "", isDefault: false, isSystem: false, channels: [] };
        actions.createNotificationTemplate.mockResolvedValue({ success: true, data: made });
        const onSuccess = renderDialog();

        await user.type(screen.getByLabelText("Name"), "Ops alerts");
        await user.click(screen.getByRole("combobox", { name: "Channel 1" }));
        await user.click(await screen.findByRole("option", { name: /#ops-alerts/ }));
        await user.click(runs(1).getByRole("button", { name: "Succeeded" }));
        await user.click(screen.getByRole("button", { name: "Create template" }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(made));
        expect(actions.createNotificationTemplate).toHaveBeenCalledWith({ name: "Ops alerts", description: "", channels: [{ configId: "ops", events: "PARTIAL|FAILED" }] });
    });

    it("asks for a channel in every row and a run for every channel before it saves", async () => {
        const user = userEvent.setup();
        renderDialog();

        await user.type(screen.getByLabelText("Name"), "Ops alerts");
        await user.click(screen.getByRole("button", { name: "Create template" }));
        expect(screen.getByText("Add at least one channel.")).toBeInTheDocument();

        await user.click(screen.getByRole("combobox", { name: "Channel 1" }));
        await user.click(await screen.findByRole("option", { name: /Admins/ }));
        for (const name of ["Succeeded", "Partial", "Failed"]) await user.click(runs(1).getByRole("button", { name }));
        await user.click(screen.getByRole("button", { name: "Create template" }));
        expect(screen.getByText("Pick at least one run for every channel.")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Add channel" }));
        await user.click(runs(1).getByRole("button", { name: "Failed" }));
        await user.click(screen.getByRole("button", { name: "Create template" }));
        expect(screen.getByText("Pick a channel in every row, or remove the row.")).toBeInTheDocument();
        expect(actions.createNotificationTemplate).not.toHaveBeenCalled();
    });

    it("leaves a channel out of the other rows once one row has it", async () => {
        const user = userEvent.setup();
        renderDialog({ start: { name: "Shop nightly notifications", channels: [{ configId: "ops", events: "PARTIAL|FAILED" }] } });

        expect(screen.getByLabelText("Name")).toHaveValue("Shop nightly notifications");
        expect(screen.getByRole("combobox", { name: "Channel 1" })).toHaveTextContent("#ops-alerts");
        expect(runs(1).getByRole("button", { name: "Succeeded" })).toHaveAttribute("aria-pressed", "false");
        expect(runs(1).getByRole("button", { name: "Failed" })).toHaveAttribute("aria-pressed", "true");

        await user.click(screen.getByRole("button", { name: "Add channel" }));
        await user.click(screen.getByRole("combobox", { name: "Channel 2" }));
        expect(screen.getByRole("option", { name: /Admins/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /#ops-alerts/ })).not.toBeInTheDocument();
    });

    it("saves a change to a template, which every job that uses it follows", async () => {
        const user = userEvent.setup();
        const template: NotificationTemplateItem = {
            id: "tpl-1",
            name: "Mail Success",
            description: null,
            isDefault: true,
            isSystem: false,
            channels: [{ id: "ch-1", configId: "admins", events: "SUCCESS", config: ADMINS }],
        };
        actions.updateNotificationTemplate.mockResolvedValue({ success: true, data: template });
        renderDialog({ template });

        expect(screen.getByRole("dialog", { name: "Edit notification template" })).toHaveTextContent("A change applies to every job that uses it");
        await user.click(runs(1).getByRole("button", { name: "Failed" }));
        await user.click(screen.getByRole("button", { name: "Save changes" }));

        await waitFor(() =>
            expect(actions.updateNotificationTemplate).toHaveBeenCalledWith("tpl-1", { name: "Mail Success", description: "", channels: [{ configId: "admins", events: "SUCCESS|FAILED" }] }),
        );
    });
});
