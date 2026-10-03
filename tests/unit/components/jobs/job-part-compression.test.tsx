import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useFormContext } from "react-hook-form";
import { CompressionPart } from "@/components/dashboard/jobs/job-part-compression";
import { jobDefaults, type JobFormValues } from "@/components/dashboard/jobs/job-form-schema";
import { Form } from "@/components/ui/form";

/** Shows what the form holds, so a test can read it. */
function Probe() {
    const form = useFormContext<JobFormValues>();
    const [algo, level, compression] = form.watch(["pgCompressionAlgo", "pgCompressionLevel", "compression"]);
    return <output aria-label="Held">{`${algo}:${level}:${compression}`}</output>;
}

function Harness({ values, isPostgres, version }: { values: Partial<JobFormValues>; isPostgres: boolean; version: number | null }) {
    const form = useForm<JobFormValues>({ defaultValues: { ...jobDefaults(null), sourceMode: "db", ...values } });
    return (
        <Form {...form}>
            <CompressionPart isPostgres={isPostgres} pgMajorVersion={version} />
            <Probe />
        </Form>
    );
}

function renderPart(values: Partial<JobFormValues>, isPostgres = true, version: number | null = 17) {
    render(<Harness values={values} isPostgres={isPostgres} version={version} />);
}

const held = () => screen.getByRole("status", { name: "Held" }).textContent;

describe("compression of a job", () => {
    it("shows the old default of a PostgreSQL job as Gzip at level 6, and keeps it until something changes", () => {
        renderPart({ pgCompressionAlgo: "LEGACY", pgCompressionLevel: 6, compression: "NONE" });

        expect(screen.getByRole("radio", { name: /^Gzip/ })).toBeChecked();
        expect(screen.getByRole("slider", { name: "Level" })).toHaveAttribute("aria-valuenow", "6");
        expect(screen.getByText("· the default")).toBeInTheDocument();
        expect(screen.getByText("pg_dump compresses the dump while it writes it, so DBackup does not compress it a second time.")).toBeInTheDocument();
        expect(screen.queryByRole("radio", { name: /^Brotli/ })).not.toBeInTheDocument();
        expect(held()).toBe("LEGACY:6:NONE");
    });

    it("moves the level of a job on the old default to Gzip with a level of its own", async () => {
        const user = userEvent.setup();
        renderPart({ pgCompressionAlgo: "LEGACY", pgCompressionLevel: 6 });

        screen.getByRole("slider", { name: "Level" }).focus();
        await user.keyboard("{ArrowRight}");

        expect(held()).toMatch(/^GZIP:7:/);
    });

    it("starts a picked compression at its own default level", async () => {
        const user = userEvent.setup();
        renderPart({ pgCompressionAlgo: "GZIP", pgCompressionLevel: 9 });

        await user.click(screen.getByRole("radio", { name: /^Zstd/ }));

        expect(held()).toMatch(/^ZSTD:3:/);
        expect(screen.getByRole("slider", { name: "Level" })).toHaveAttribute("aria-valuemax", "22");
    });

    it("keeps what an older PostgreSQL cannot do out of reach and says why", () => {
        renderPart({ pgCompressionAlgo: "GZIP", pgCompressionLevel: 6 }, true, 13);

        expect(screen.getByRole("radio", { name: /^LZ4/ })).toBeDisabled();
        expect(screen.getByRole("radio", { name: /^Zstd/ })).toBeDisabled();
        expect(screen.getByText("Needs PostgreSQL 14")).toBeInTheDocument();
        expect(screen.getByText("Needs PostgreSQL 16")).toBeInTheDocument();
    });

    it("lets DBackup compress the backup when pg_dump does not", () => {
        renderPart({ pgCompressionAlgo: "NONE", compression: "GZIP" });

        expect(screen.getByText("The backup")).toBeInTheDocument();
        expect(screen.getByText("compressed by DBackup instead")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /Small and fast, the usual pick/ })).toBeChecked();
        expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });

    it("gives the folders of a PostgreSQL job their own row", () => {
        renderPart({ sourceMode: "both", pgCompressionAlgo: "ZSTD", pgCompressionLevel: 3, compression: "BROTLI" });

        expect(screen.getByText("The dump")).toBeInTheDocument();
        expect(screen.getByText("The folders")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /^Brotli/ })).toBeChecked();
        expect(screen.getByText("pg_dump compresses the dump while it writes it, DBackup compresses the folders.")).toBeInTheDocument();
    });

    it("offers one choice for a database that DBackup compresses", async () => {
        const user = userEvent.setup();
        renderPart({ compression: "GZIP" }, false, null);

        expect(screen.queryByText("The dump")).not.toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /^Brotli/ }));

        expect(held()).toMatch(/:BROTLI$/);
    });
});
