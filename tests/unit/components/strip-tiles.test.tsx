import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CircleCheck, Users } from "lucide-react";
import { ConnectionStrip } from "@/components/adapter/connection-strip";
import { JobsStrip } from "@/components/dashboard/jobs/jobs-strip";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";

/** A tile by the label of its number. */
const tileOf = (label: string) => screen.getByText(label).closest(".rounded-lg") as HTMLElement;

describe("the numbers above a list", () => {
    it("show a tile per number with its icon, the number, its unit and what it counts", () => {
        render(<ExplorerStrip joined cells={[
            { label: "Users", icon: Users, value: "5", extra: "4 in a group" },
            { label: "Succeeded", icon: CircleCheck, value: "100", unit: "%", tone: "success", extra: "412 of 412" },
        ]} />);

        const users = tileOf("Users");
        expect(users).toHaveTextContent("5");
        expect(users.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
        expect(tileOf("Succeeded")).toHaveTextContent("100%");
        expect(tileOf("Succeeded").querySelector(".text-success")).not.toBeNull();
    });

    it("keep the sentence for screen readers and a phone, and show it on hover", async () => {
        render(<ExplorerStrip joined cells={[{ label: "Users", icon: Users, value: "5", extra: "4 in a group" }]} />);

        expect(screen.getByText("4 in a group")).toHaveClass("md:sr-only");
        await userEvent.setup().hover(tileOf("Users"));
        expect(await screen.findByRole("tooltip")).toHaveTextContent("4 in a group");
    });

    it("sit a shade above the card inside it, and are cards of their own on the page", () => {
        const { rerender } = render(<ExplorerStrip joined cells={[{ label: "Users", icon: Users, value: "5" }]} />);
        expect(tileOf("Users")).toHaveClass("md:bg-foreground/4", "md:border-transparent");

        rerender(<ExplorerStrip cells={[{ label: "Users", icon: Users, value: "5" }]} />);
        expect(tileOf("Users")).toHaveClass("bg-card");
        expect(tileOf("Users")).not.toHaveClass("md:bg-foreground/4");
    });
});

const job = (name: string, runs: string[], extra: Record<string, unknown> = {}) => ({
    name,
    enabled: true,
    overview: { runs: runs.map((status) => ({ status })), live: null, nextRunAt: null, ...extra },
    ...("enabled" in extra ? { enabled: extra.enabled } : {}),
});

describe("the numbers of the Jobs page", () => {
    it("count the jobs, how their latest runs went, which need attention, the next run and what runs", () => {
        const soon = new Date(Date.now() + 12 * 60_000).toISOString();
        const later = new Date(Date.now() + 5 * 3_600_000).toISOString();
        render(<JobsStrip jobs={[
            job("Nightly MySQL", ["Success", "Failed"], { nextRunAt: later }),
            job("Files to NAS", ["Success", "Partial"]),
            job("Cache snapshot", ["Success", "Success"], { nextRunAt: soon }),
            job("Nightly Postgres", ["Success", "Running"], { live: { status: "Running", progress: 64 } }),
            job("Legacy ERP", ["Success"], { enabled: false }),
        ] as never} />);

        expect(tileOf("Jobs")).toHaveTextContent("5");
        expect(screen.getByText("4 on their schedule, 1 paused")).toBeInTheDocument();
        expect(tileOf("Succeeded")).toHaveTextContent("75%");
        expect(screen.getByText("6 of the latest 8 runs")).toBeInTheDocument();
        expect(tileOf("Needs attention")).toHaveTextContent("2");
        expect(tileOf("Needs attention").querySelector(".text-destructive")).not.toBeNull();
        expect(screen.getByText("Nightly MySQL failed, Files to NAS missed a copy")).toBeInTheDocument();
        expect(tileOf("Next run")).toHaveTextContent("in 12 minutes");
        expect(screen.getByText("Cache snapshot")).toBeInTheDocument();
        expect(screen.getByText("Nightly Postgres 64 %")).toBeInTheDocument();
    });
});

const connection = (name: string, overview: Record<string, unknown> = {}, lastStatus = "ONLINE", adapterId = "mysql") => ({
    id: name,
    name,
    adapterId,
    lastStatus,
    overview: { usedBy: { jobs: 1, templates: 0 }, lastBackup: null, latencyMs: null, stored: null, lastSent: null, ...overview },
});

describe("the numbers of the Connections page", () => {
    it("say for databases how many answer, how fast, which are in a job and the last backup", () => {
        render(<ConnectionStrip kind="database" configs={[
            connection("db-prod", { latencyMs: null }, "OFFLINE"),
            connection("shop-pg", { latencyMs: 12, lastBackup: { at: new Date(Date.now() - 120_000).toISOString() } }, "ONLINE", "postgres"),
            connection("crm", { latencyMs: 18 }),
            connection("test-mysql", { latencyMs: 9, usedBy: { jobs: 0, templates: 0 } }),
        ] as never} />);

        expect(tileOf("Databases")).toHaveTextContent("4");
        expect(screen.getByText("MySQL 3, PostgreSQL")).toBeInTheDocument();
        expect(tileOf("Answering")).toHaveTextContent("3of 4");
        expect(screen.getByText("db-prod does not answer")).toBeInTheDocument();
        expect(tileOf("Response")).toHaveTextContent("12ms");
        expect(screen.getByText("the median, crm slowest at 18 ms")).toBeInTheDocument();
        expect(tileOf("In a job")).toHaveTextContent("3of 4");
        expect(screen.getByText("test-mysql is in no job")).toBeInTheDocument();
        expect(tileOf("Last backup")).toHaveTextContent("2 minutes ago");
    });

    it("say for destinations what they store, and for channels where they are used and whether the last message went out", () => {
        const { unmount } = render(<ConnectionStrip kind="destination" configs={[
            connection("NAS", { stored: { size: 2 * 1024 ** 3, count: 40 } }, "ONLINE", "local-filesystem"),
            connection("S3", { stored: { size: 1024 ** 3, count: 20 } }, "DEGRADED", "s3-aws"),
        ] as never} />);
        expect(tileOf("Stored")).toHaveTextContent("3GB");
        expect(screen.getByText("60 backups at the last scan")).toBeInTheDocument();
        expect(tileOf("Answering").querySelector(".text-warning")).not.toBeNull();
        unmount();

        render(<ConnectionStrip kind="notification" configs={[
            connection("Slack ops", { usedBy: { jobs: 2, templates: 1 }, lastSent: { at: new Date().toISOString(), status: "Failed" } }, "ONLINE", "slack"),
            connection("Mail", { usedBy: { jobs: 0, templates: 0 } }, "ONLINE", "email"),
        ] as never} />);
        expect(screen.queryByText("Answering")).toBeNull();
        expect(tileOf("In use")).toHaveTextContent("1of 2");
        expect(screen.getByText("by 2 jobs and 1 template")).toBeInTheDocument();
        expect(tileOf("Failed")).toHaveTextContent("1");
        expect(screen.getByText("the last message of Slack ops failed")).toBeInTheDocument();
    });
});
