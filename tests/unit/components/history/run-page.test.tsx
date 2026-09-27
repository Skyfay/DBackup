import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { detail, liveDetail, serve } from "./history-fixtures";

let search = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, back }),
    useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({
    useSession: () => ({ data: { user: { timezone: "UTC", dateFormat: "yyyy-MM-dd", timeFormat: "HH:mm" } } }),
}));

import { originOf, runHref } from "@/components/dashboard/history/run-links";
import { RunPage } from "@/components/dashboard/history/run-page";

Element.prototype.scrollIntoView = vi.fn();
const access = { canExecute: true, canOpenJobs: true, canOpenBackups: true, canOpenConnections: true };
const open = (address: string) => {
    search = new URLSearchParams(address);
    return render(<RunPage access={access} />);
};

describe("run links", () => {
    it("name the page a run was opened from, and lead to History from outside the app", () => {
        expect(runHref("a b", "overview")).toBe("/dashboard/history/run?id=a%20b&from=overview");
        expect(originOf("jobs")).toEqual({ key: "jobs", label: "Jobs", href: "/dashboard/jobs" });
        expect(originOf(null).label).toBe("History");
        expect(originOf("elsewhere").key).toBe("history");
    });
});

describe("the page of a run", () => {
    beforeEach(() => {
        push.mockClear();
        replace.mockClear();
        back.mockClear();
    });

    it("names where the back arrow leads and goes there", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite&from=overview");

        const button = await screen.findByRole("button", { name: "Back to Overview" });
        await user.click(button);
        // A fresh tab has nothing to go back to, so it opens the Overview.
        expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("shows the steps with their usual times, every copy under its step, and the numbers of the run", async () => {
        serve();
        open("id=offsite&from=history");

        const steps = await screen.findByRole("region", { name: "Steps" });
        expect(within(steps).getByText("3m 10s")).toBeInTheDocument();
        expect(within(steps).getByText("NAS Backups")).toBeInTheDocument();
        expect(within(steps).getByText("403 quota")).toBeInTheDocument();
        expect(within(steps).getByText("1 of 2 stored")).toBeInTheDocument();
        expect(screen.getByText("Google Drive failed")).toBeInTheDocument();
    });

    it("tells each problem once in plain words, with what to do and a way to its lines", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite");

        expect(await screen.findByText("To look at")).toBeInTheDocument();
        const log = screen.getByRole("region", { name: "Log" });
        expect(within(log).getByText("the 3 lines of this problem")).toBeInTheDocument();
        expect(screen.getAllByText("Google Drive is full").length).toBeGreaterThan(1);
        expect(screen.getByText("Tried 3 times, the tries are folded into this one")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Open destination/ })).toHaveAttribute("href", "/dashboard/connections?tab=destinations");

        await user.click(screen.getAllByRole("button", { name: /Show in log/ })[0]);
        // The problems count in the order of the log, the dump warning comes first.
        expect(within(log).getByText("2 of 2")).toBeInTheDocument();
    });

    it("shows only the lines of a step once it is picked", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite");

        const steps = await screen.findByRole("region", { name: "Steps" });
        await user.click(within(steps).getByRole("button", { name: /Dumping Databases/ }));
        const log = screen.getByRole("region", { name: "Log" });
        expect(within(log).getByText("the lines of Dumping Databases")).toBeInTheDocument();
        expect(within(log).queryByText("[NAS Backups] Upload complete: Shop offsite/a.tar")).not.toBeInTheDocument();
    });

    it("follows a live run with its progress, the upload in one row, who waits and a way to cancel it", async () => {
        serve({ run: liveDetail() });
        open("id=crm&from=overview");

        expect(await screen.findByRole("button", { name: /Cancel run/ })).toBeInTheDocument();
        expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
        expect(screen.getByText("Waits for this run")).toBeInTheDocument();
        expect(screen.getByText("Shop nightly")).toBeInTheDocument();
        const log = screen.getByRole("region", { name: "Log" });
        expect(within(log).getByText(/64 % · 39 MB of 61 MB/)).toBeInTheDocument();
        expect(within(log).getByRole("button", { name: /Following/ })).toBeInTheDocument();
        expect(within(log).getByText(/Then Verifying/)).toBeInTheDocument();
    });

    it("steps to the run before without losing where the back arrow leads", async () => {
        serve();
        const user = userEvent.setup();
        open("id=offsite&from=jobs");

        await user.click(await screen.findByRole("button", { name: "The run before" }));
        expect(replace).toHaveBeenCalledWith("/dashboard/history/run?id=offsite-before&from=jobs", { scroll: false });
    });

    it("says when a run is gone and leads back", async () => {
        serve({ run: null });
        open("id=gone&from=backups");

        expect(await screen.findByText("This run could not be found")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Back to Backups/ })).toHaveAttribute("href", "/dashboard/backups");
    });

    it("explains a log that data retention removed", async () => {
        serve({ run: detail({ logsPurgedAt: "2026-09-01T00:00:00.000Z" }) });
        open("id=offsite");

        expect(await screen.findByText("The log of this run was removed")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy the log" })).toBeDisabled();
    });
});
