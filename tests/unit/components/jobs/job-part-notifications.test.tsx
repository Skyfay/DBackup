import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useFormContext } from "react-hook-form";
import { NotificationsPart } from "@/components/dashboard/jobs/job-part-notifications";
import { jobDefaults, type AdapterOption, type JobFormValues } from "@/components/dashboard/jobs/job-form-schema";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { Form } from "@/components/ui/form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({
    getNotificationTemplates: vi.fn(),
    createNotificationTemplate: vi.fn(),
    updateNotificationTemplate: vi.fn(),
}));
vi.mock("@/app/actions/templates", () => actions);

const ADMINS = { id: "admins", name: "Admins", adapterId: "email" };
const OPS = { id: "ops", name: "#ops-alerts", adapterId: "slack" };
const SMS = { id: "sms", name: "On-call phone", adapterId: "twilio-sms" };
const TEAMS = { id: "teams", name: "Platform team", adapterId: "teams" };
const CHANNELS: AdapterOption[] = [ADMINS, OPS, SMS, TEAMS];

function template(id: string, name: string, channels: [typeof ADMINS, string][], extra: Record<string, unknown> = {}) {
    return {
        id,
        name,
        description: null,
        isDefault: false,
        isSystem: false,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        channels: channels.map(([config, events], index) => ({ id: `${id}-${index}`, templateId: id, configId: config.id, events, config })),
        _count: { jobs: 1 },
        ...extra,
    };
}

const TEMPLATES = [
    template("mail", "Mail Success", [[ADMINS, "SUCCESS"]], { isDefault: true, _count: { jobs: 9 } }),
    template("ops", "Ops alerts", [[OPS, "PARTIAL|FAILED"], [SMS, "FAILED"]], { description: "For the on-call team", _count: { jobs: 6 } }),
    template("team", "Team chat", [[TEAMS, "SUCCESS|PARTIAL|FAILED"], [OPS, "FAILED"]]),
];

/** Shows what the form holds, so a test can read it. */
function Probe() {
    const form = useFormContext<JobFormValues>();
    return (
        <>
            <output aria-label="Templates">{form.watch("notificationTemplateIds").join(",")}</output>
            <output aria-label="Channels named directly">{form.watch("notificationIds").join(",")}</output>
        </>
    );
}

function Harness({ values }: { values: Partial<JobFormValues> }) {
    const form = useForm<JobFormValues>({ defaultValues: { ...jobDefaults(null), name: "Shop nightly", ...values } });
    return (
        <Form {...form}>
            <NotificationsPart channels={CHANNELS} />
            <Probe />
        </Form>
    );
}

function renderPart(values: Partial<JobFormValues>, permissions?: string[]) {
    const part = <Harness values={values} />;
    render(permissions ? <PermissionsProvider permissions={permissions}>{part}</PermissionsProvider> : part);
}

const held = (name: string) => screen.getByRole("status", { name }).textContent;

describe("notifications of a job", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        actions.getNotificationTemplates.mockResolvedValue({ success: true, data: TEMPLATES });
    });

    it("shows each template with its channels and runs, and who hears about a run over all of them", async () => {
        renderPart({ notificationTemplateIds: ["mail", "ops"] });

        const ops = await screen.findByText("For the on-call team · 2 channels · Also used by 5 jobs");
        expect(ops).toBeInTheDocument();
        expect(screen.getByText("1 channel · Also used by 8 jobs")).toBeInTheDocument();

        const table = screen.getByRole("table");
        expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
            "ChannelSucceededPartialFailed",
            "AdminsEmail (SMTP) · from Mail Success1 messageNo messageNo message",
            "#ops-alertsSlack Webhook · from Ops alertsNo message1 message1 message",
            "On-call phoneSMS (Twilio) · from Ops alertsNo messageNo message1 message",
        ]);
        expect(screen.getByText("After a failed run 2 channels hear about it, after a successful one 1.")).toBeInTheDocument();
    });

    it("adds a template from a list that leaves out the ones on the job, and warns about a channel told twice", async () => {
        const user = userEvent.setup();
        renderPart({ notificationTemplateIds: ["mail", "ops"] });

        const field = await screen.findByRole("combobox", { name: "Add a notification template" });
        await waitFor(() => expect(field).toBeEnabled());
        await user.click(field);
        expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([expect.stringContaining("Team chat")]);
        await user.click(screen.getByRole("option", { name: /Team chat/ }));

        expect(held("Templates")).toBe("mail,ops,team");
        expect(within(screen.getByRole("table")).getByText("2 messages")).toBeInTheDocument();
        expect(screen.getByText("#ops-alerts is in Ops alerts and Team chat, so it gets two messages after a failed run.")).toBeInTheDocument();
    });

    it("removes a template from the job", async () => {
        const user = userEvent.setup();
        renderPart({ notificationTemplateIds: ["mail", "ops"] });

        await user.click(await screen.findByRole("button", { name: "Remove Mail Success" }));

        expect(held("Templates")).toBe("ops");
        expect(screen.getByText("After a failed run 2 channels hear about it, after a successful one nobody.")).toBeInTheDocument();
    });

    it("says nobody hears about a job without a template", async () => {
        renderPart({ notificationTemplateIds: [] });

        expect(await screen.findByText("Nobody hears about this job")).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("turns the channels a job names directly into a template that takes their place", async () => {
        const user = userEvent.setup();
        const made = template("made", "Shop nightly notifications", [[ADMINS, "PARTIAL|FAILED"]], { _count: undefined });
        actions.createNotificationTemplate.mockResolvedValue({ success: true, data: made });
        renderPart({ notificationTemplateIds: [], notificationIds: ["admins"], notificationEvents: ["PARTIAL", "FAILED"] });

        expect(await screen.findByText("Channels named directly")).toBeInTheDocument();
        expect(within(screen.getByRole("table")).getByText("Email (SMTP) · Named directly")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Make a template of them" }));
        const dialog = await screen.findByRole("dialog", { name: "New notification template" });
        expect(within(dialog).getByLabelText("Name")).toHaveValue("Shop nightly notifications");
        await user.click(within(dialog).getByRole("button", { name: "Create template" }));

        await waitFor(() => expect(held("Templates")).toBe("made"));
        expect(held("Channels named directly")).toBe("");
        expect(actions.createNotificationTemplate).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Shop nightly notifications", channels: [{ configId: "admins", events: "PARTIAL|FAILED" }] }),
        );
    });

    it("says that channels named directly next to a template are never told, and removes them", async () => {
        const user = userEvent.setup();
        renderPart({ notificationTemplateIds: ["mail"], notificationIds: ["admins"] });

        expect(await screen.findByText(/Admins is also named directly/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Remove them" }));

        expect(held("Channels named directly")).toBe("");
    });

    it("offers neither New nor Edit to a viewer who may not write templates", async () => {
        renderPart({ notificationTemplateIds: ["mail"] }, ["jobs:write", "templates:read"]);

        expect(await screen.findByRole("button", { name: "Remove Mail Success" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Edit Mail Success" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    });
});
