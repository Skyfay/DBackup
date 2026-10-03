import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchedulePicker } from "@/components/dashboard/jobs/schedule-picker";
import type { ScheduleLoad } from "@/lib/core/schedule-conflicts";

vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timezone: "UTC", timeFormat: "HH:mm" } } }) }));

const MAIL = { id: "mail", name: "Mail archive", schedule: "0 3 * * *", presetId: null, estimatedMs: 6 * 60_000 };

function serve(load: ScheduleLoad | null) {
    const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
    global.fetch = vi.fn((url: string) => {
        if (url === "/api/system/timezone") return json({ schedulerTimezone: "UTC" });
        if (url === "/api/jobs/schedules") return load ? json({ success: true, data: load }) : json({ success: false, error: "Forbidden" }, false);
        return json({ error: `Unexpected ${url}` }, false);
    }) as unknown as typeof fetch;
}

describe("schedule picker", () => {
    beforeEach(() => {
        serve(null);
    });

    it("builds a weekday schedule from the days and says it in words", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SchedulePicker value="0 3 * * *" onChange={onChange} />);

        await user.click(screen.getByRole("tab", { name: "Weekly" }));
        expect(onChange).toHaveBeenLastCalledWith("0 3 * * 0");
        await user.click(screen.getByRole("button", { name: "Weekdays" }));

        expect(onChange).toHaveBeenLastCalledWith("0 3 * * 1-5");
        expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText("Weekdays at 03:00")).toBeInTheDocument();
    });

    it("warns when the queue has no slot left at that time, and moves the run to a free one", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        serve({ timezone: "UTC", slots: 1, jobs: [MAIL] });
        render(<SchedulePicker value="0 3 * * *" onChange={onChange} />);

        expect(await screen.findByText(/Mail archive also runs at/)).toHaveTextContent("only one job runs at a time, so this job waits about 6 min for it.");
        await user.click(screen.getByRole("button", { name: "Use 03:15" }));

        expect(onChange).toHaveBeenLastCalledWith("15 3 * * *");
        expect(screen.queryByText(/Mail archive also runs at/)).not.toBeInTheDocument();
    });

    it("stays quiet while the queue has a slot for every run", async () => {
        serve({ timezone: "UTC", slots: 2, jobs: [MAIL] });
        render(<SchedulePicker value="0 3 * * *" onChange={vi.fn()} />);

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/jobs/schedules"));
        await screen.findByText(/^Next/);
        expect(screen.queryByText(/also runs at/)).not.toBeInTheDocument();
    });

    it("says what is wrong with a cron expression that cannot run", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SchedulePicker value="0 3 * * *" onChange={onChange} />);

        await user.click(screen.getByRole("tab", { name: "Cron" }));
        const input = screen.getByRole("textbox", { name: "Cron expression" });
        await user.clear(input);
        await user.type(input, "0 3 * *");

        expect(onChange).toHaveBeenLastCalledWith("0 3 * *");
        expect(screen.getByText("Needs five parts, like 0 3 * * * for every day at 03:00.")).toBeInTheDocument();
        expect(input).toHaveAttribute("aria-invalid", "true");
    });
});
