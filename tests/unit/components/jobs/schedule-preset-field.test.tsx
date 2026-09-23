import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchedulePresetField } from "@/components/dashboard/jobs/schedule-preset-field";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: { user: { timeFormat: "HH:mm" } } }) }));

const actions = vi.hoisted(() => ({
    getSchedulePresets: vi.fn(),
    createSchedulePreset: vi.fn(),
    updateSchedulePreset: vi.fn(),
}));
vi.mock("@/app/actions/templates", () => actions);

const preset = (id: string, name: string, schedule: string, jobs: number) => ({
    id,
    name,
    schedule,
    description: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    _count: { jobs },
});

const PRESETS = [preset("nightly", "Daily at 3 AM", "0 3 * * *", 2), preset("weekly", "Weekly on Sunday", "0 2 * * 0", 0)];

describe("schedule preset field", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        actions.getSchedulePresets.mockResolvedValue({ success: true, data: PRESETS });
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ schedulerTimezone: "UTC" }) } as Response));
    });

    it("lists the presets with when they run and how many jobs follow them, and picks one", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SchedulePresetField value={null} onChange={onChange} aria-label="Preset" />);

        const trigger = screen.getByRole("combobox", { name: "Preset" });
        await waitFor(() => expect(trigger).toHaveTextContent("Pick from Templates"));
        await user.click(trigger);

        expect(screen.getByText("Schedule presets")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Daily at 3 AM/ })).toHaveTextContent("Every day at 03:00 · Used by 2 jobs");
        expect(screen.getByRole("option", { name: /Weekly on Sunday/ })).toHaveTextContent("Not used yet");

        await user.click(screen.getByRole("option", { name: /Weekly on Sunday/ }));
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "weekly" }));
    });

    it("adds a preset with New beside the field and picks it", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        actions.createSchedulePreset.mockResolvedValue({ success: true, data: { ...preset("hourly", "Hourly", "0 * * * *", 0), _count: undefined } });
        render(<SchedulePresetField value={null} onChange={onChange} />);

        await user.click(await screen.findByRole("button", { name: "New" }));
        const dialog = await screen.findByRole("dialog", { name: "New schedule preset" });
        await user.click(within(dialog).getByRole("button", { name: "Create preset" }));
        expect(within(dialog).getByText("Give the preset a name.")).toBeInTheDocument();
        expect(actions.createSchedulePreset).not.toHaveBeenCalled();

        await user.type(within(dialog).getByLabelText("Name"), "Hourly");
        await user.click(within(dialog).getByRole("button", { name: "Create preset" }));

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "hourly" })));
        expect(actions.createSchedulePreset).toHaveBeenCalledWith({ name: "Hourly", description: "", schedule: "0 3 * * *" });
    });

    it("edits a preset from its row without picking it for the job", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        actions.updateSchedulePreset.mockResolvedValue({ success: true, data: { ...PRESETS[1], name: "Sundays", _count: undefined } });
        render(<SchedulePresetField value="nightly" onChange={onChange} aria-label="Preset" />);

        const trigger = screen.getByRole("combobox", { name: "Preset" });
        await waitFor(() => expect(trigger).toHaveTextContent("Daily at 3 AM"));
        await user.click(trigger);
        await user.click(screen.getByRole("button", { name: "Edit Weekly on Sunday" }));
        const dialog = await screen.findByRole("dialog", { name: "Edit schedule preset" });
        await user.clear(within(dialog).getByLabelText("Name"));
        await user.type(within(dialog).getByLabelText("Name"), "Sundays");
        await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

        await waitFor(() => expect(actions.updateSchedulePreset).toHaveBeenCalledWith("weekly", expect.objectContaining({ name: "Sundays" })));
        expect(onChange).not.toHaveBeenCalled();
    });
});
