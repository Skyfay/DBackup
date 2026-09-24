import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useFormContext } from "react-hook-form";
import { IncrementalPart } from "@/components/dashboard/jobs/job-part-incremental";
import { jobDefaults, type AdapterOption, type JobFormValues } from "@/components/dashboard/jobs/job-form-schema";
import { Form } from "@/components/ui/form";

const SOURCES: AdapterOption[] = [{ id: "pg", name: "Shop cluster", adapterId: "postgres", type: "database" }];
const FOLDERS: AdapterOption[] = [{ id: "app", name: "App server", adapterId: "sftp", type: "storage" }];
const FOLDER = { configId: "app", path: "/var/www/shop", excludePatterns: [], excludePatternPresetIds: [], stopContainers: true };

/** Shows what the form holds, so a test can read it. */
function Probe() {
    const form = useFormContext<JobFormValues>();
    const [mode, days] = form.watch(["backupMode", "fullEveryDays"]);
    return <output aria-label="Held">{`${mode}:${days}`}</output>;
}

function Harness({ values }: { values: Partial<JobFormValues> }) {
    const form = useForm<JobFormValues>({
        defaultValues: { ...jobDefaults(null), sourceMode: "dirs", directorySources: [FOLDER], schedule: "0 3 * * *", ...values },
    });
    return (
        <Form {...form}>
            <IncrementalPart sources={SOURCES} folderOptions={FOLDERS} />
            <Probe />
        </Form>
    );
}

const held = () => screen.getByRole("status", { name: "Held" }).textContent;

describe("incremental backups of a job", () => {
    beforeEach(() => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ schedulerTimezone: "UTC" }) } as Response)) as unknown as typeof fetch;
    });

    it("says why a job of only a database backs up in full, whatever an earlier setting left", () => {
        render(<Harness values={{ sourceMode: "db", directorySources: [], sourceId: "pg", backupMode: "INCREMENTAL" }} />);

        expect(screen.getByRole("radio", { name: /^Every backup in full/ })).toBeChecked();
        expect(screen.getByRole("radio", { name: /^Every backup in full/ })).toBeDisabled();
        expect(screen.getByRole("radio", { name: /^Only what changed/ })).toBeDisabled();
        expect(screen.getByText(/^So far only folders can be stored in part\. This job backs up only a database/)).toBeInTheDocument();
        expect(screen.queryByText("The chain")).not.toBeInTheDocument();
    });

    it("starts a new job of folders in full, and builds chains only once the user picks only what changed", async () => {
        const user = userEvent.setup();
        render(<Harness values={{}} />);

        expect(screen.getByRole("radio", { name: /^Every backup in full/ })).toBeChecked();
        expect(held()).toBe("FULL:7");

        expect(screen.getByText("Every backup is complete on its own. Losing one costs only that one.")).toBeInTheDocument();
        expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

        await user.click(screen.getByRole("radio", { name: /^Only what changed/ }));

        expect(held()).toBe("INCREMENTAL:7");
        expect(await screen.findByText("Each chain is a full backup, then 6 incremental ones.")).toBeInTheDocument();
    });

    it("steps the days between full backups from 1 to 365, and the chain follows them", async () => {
        const user = userEvent.setup();
        render(<Harness values={{ backupMode: "INCREMENTAL", fullEveryDays: 2 }} />);

        expect(await screen.findByText("Each chain is a full backup, then 1 incremental one.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Fewer days" }));

        expect(held()).toBe("INCREMENTAL:1");
        expect(await screen.findByText("Every backup is a full one, since the runs are at least a day apart.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Fewer days" })).toBeDisabled();

        const field = screen.getByRole("spinbutton", { name: "Full backup every" });
        await user.clear(field);
        await user.type(field, "400");
        await user.tab();
        // 40 was in range while typing, 400 is not, so the field goes back to 40.
        expect(held()).toBe("INCREMENTAL:40");
        expect(field).toHaveValue("40");

        field.focus();
        await user.keyboard("{ArrowUp}");
        expect(held()).toBe("INCREMENTAL:41");
    });

    it("warns about a chain of 168 hourly backups, and a full backup every day shortens it to 24", async () => {
        const user = userEvent.setup();
        render(<Harness values={{ backupMode: "INCREMENTAL", schedule: "0 * * * *" }} />);

        const warning = await screen.findByText(/^A chain of 168 backups: a damaged one takes every backup built on it\./);
        expect(warning).toHaveTextContent("A new full every day keeps a chain at 24.");
        await user.click(screen.getByRole("button", { name: "Every day" }));

        expect(held()).toBe("INCREMENTAL:1");
        await waitFor(() => expect(screen.queryByText(/^A chain of/)).not.toBeInTheDocument());
        expect(screen.getByText("Each chain is a full backup, then 23 incremental ones.")).toBeInTheDocument();
    });

    it("lists the database in full in every run and each folder with only its changes", () => {
        render(<Harness values={{ sourceMode: "both", sourceId: "pg", backupMode: "INCREMENTAL" }} />);

        const rows = screen.getAllByRole("listitem");
        expect(rows[0]).toHaveTextContent("Shop clusterPostgreSQL · a dump is always wholeIn full every run");
        expect(rows[1]).toHaveTextContent("App server · /var/www/shopSFTP (SSH)Only changes");
    });
});
