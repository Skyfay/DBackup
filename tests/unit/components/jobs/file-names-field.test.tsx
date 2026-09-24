import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useFormContext } from "react-hook-form";
import { FileNamesField } from "@/components/dashboard/jobs/file-names-field";
import { jobDefaults, type JobFormValues } from "@/components/dashboard/jobs/job-form-schema";
import { Form } from "@/components/ui/form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({ getNamingTemplates: vi.fn(), createNamingTemplate: vi.fn(), updateNamingTemplate: vi.fn() }));
vi.mock("@/app/actions/templates", () => actions);

const template = (id: string, name: string, pattern: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    description: null,
    pattern,
    isDefault: false,
    isSystem: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    _count: { jobs: 0 },
    ...extra,
});

const TEMPLATES = [
    template("date", "Date only", "{job_name}_yyyy-MM-dd", { _count: { jobs: 2 } }),
    template("standard", "Standard", "{job_name}_yyyy-MM-dd_HH-mm-ss", { isDefault: true, isSystem: true, _count: { jobs: 7 } }),
];

function Probe() {
    const form = useFormContext<JobFormValues>();
    return <output aria-label="Template">{form.watch("namingTemplateId") ?? "default"}</output>;
}

function Harness({ values }: { values: Partial<JobFormValues> }) {
    const form = useForm<JobFormValues>({ defaultValues: { ...jobDefaults(null), name: "Shop nightly", schedule: "0 */6 * * *", ...values } });
    return (
        <Form {...form}>
            <FileNamesField />
            <Probe />
        </Form>
    );
}

const held = () => screen.getByRole("status", { name: "Template" }).textContent;

describe("file names of a job", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        actions.getNamingTemplates.mockResolvedValue({ success: true, data: TEMPLATES });
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ schedulerTimezone: "UTC" }) } as Response)) as unknown as typeof fetch;
    });

    it("warns when two runs of the schedule get the same name, and offers a template that has the time", async () => {
        const user = userEvent.setup();
        render(<Harness values={{ namingTemplateId: "date" }} />);

        const warning = await screen.findByText(/get the same file name/);
        expect(warning).toHaveTextContent("The later backup replaces the earlier one at every destination");
        await user.click(screen.getByRole("button", { name: "Use Standard" }));

        expect(held()).toBe("default");
        await waitFor(() => expect(screen.queryByText(/get the same file name/)).not.toBeInTheDocument());
    });

    it("warns a paused job too, since its schedule is still set for when it runs again", async () => {
        render(<Harness values={{ namingTemplateId: "date", schedule: "0 * * * *", enabled: false }} />);

        expect(await screen.findByText(/^Once the job runs on its schedule again, the runs on .+ get the same file name/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Use Standard" })).toBeInTheDocument();
        expect(screen.queryByText(/The name has no time of day/)).not.toBeInTheDocument();
    });

    it("stays quiet for an incremental job, whose chain position is part of every name", async () => {
        render(<Harness values={{ namingTemplateId: "date", sourceMode: "dirs", backupMode: "INCREMENTAL" }} />);

        expect(await screen.findByText(/full-000/)).toBeInTheDocument();
        expect(screen.queryByText(/get the same file name/)).not.toBeInTheDocument();
    });

    it("notes that a name without the time only takes one backup a day", async () => {
        render(<Harness values={{ namingTemplateId: "date", schedule: "0 3 * * *" }} />);

        expect(await screen.findByText(/The name has no time of day/)).toBeInTheDocument();
        expect(screen.queryByText(/get the same file name/)).not.toBeInTheDocument();
    });

    it("shows a name the job writes, and lists the default template first with the pattern of each", async () => {
        const user = userEvent.setup();
        render(<Harness values={{}} />);

        expect(await screen.findByText(/^Shop_nightly_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar$/)).toBeInTheDocument();
        const field = screen.getByRole("combobox", { name: "File names" });
        await waitFor(() => expect(field).toBeEnabled());
        await user.click(field);

        const options = screen.getAllByRole("option");
        expect(options[0]).toHaveTextContent("Default templateFollows the template marked as the default, now Standard");
        expect(options[1]).toHaveTextContent("Date only{job_name}_yyyy-MM-dd · Used by 2 jobs");
        expect(options[2]).toHaveTextContent("StandardDefault · {job_name}_yyyy-MM-dd_HH-mm-ss · Used by 7 jobs");
    });
});
