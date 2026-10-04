import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_RETENTION_SENTINEL, RetentionPolicyPicker } from "@/components/templates/retention-policy-picker";
import { describeRetention } from "@/components/templates/retention-words";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({
    getRetentionPolicies: vi.fn(),
    createRetentionPolicy: vi.fn(),
    updateRetentionPolicy: vi.fn(),
}));
vi.mock("@/app/actions/templates", () => actions);

const policy = (id: string, name: string, config: object, extra: { isDefault?: boolean; isSystem?: boolean; used?: number } = {}) => ({
    id,
    name,
    description: null,
    config: JSON.stringify(config),
    isDefault: extra.isDefault ?? false,
    isSystem: extra.isSystem ?? false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    _count: { jobDestinations: extra.used ?? 0 },
});

const POLICIES = [
    policy("keep", "Keep All", { mode: "NONE" }, { isSystem: true }),
    policy("simple", "Simple - 14 Days", { mode: "SIMPLE", simple: { keepCount: 14 } }, { used: 2 }),
    policy("gfs", "Smart GFS", { mode: "SMART", smart: { daily: 7, weekly: 4, monthly: 12, yearly: 2 } }, { isDefault: true }),
];

describe("retention policy picker", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        actions.getRetentionPolicies.mockResolvedValue({ success: true, data: POLICIES });
    });

    async function open(user: ReturnType<typeof userEvent.setup>, value: string | null = DEFAULT_RETENTION_SENTINEL) {
        const onChange = vi.fn();
        render(<RetentionPolicyPicker value={value} onChange={onChange} allowDefault aria-label="Retention of destination 1" />);
        const trigger = screen.getByRole("combobox", { name: "Retention of destination 1" });
        await waitFor(() => expect(trigger).toBeEnabled());
        await user.click(trigger);
        return onChange;
    }

    it("says what each policy keeps and how many destinations follow it, the default first", async () => {
        const user = userEvent.setup();
        await open(user);

        expect(screen.getByRole("option", { name: /Default policy/ })).toHaveTextContent("Smart GFS · 7 daily, 4 weekly, 12 monthly, 2 yearly");
        expect(screen.getByRole("option", { name: /Simple - 14 Days/ })).toHaveTextContent("Keeps the last 14 · Used by 2 destinations");
        expect(screen.getByRole("option", { name: /Keep All/ })).toHaveTextContent("Keeps everything · Not used yet");
    });

    it("lets a policy of DBackup itself stay as it is, while the others can be edited", async () => {
        const user = userEvent.setup();
        await open(user);

        expect(screen.getByRole("button", { name: "Edit Smart GFS" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Edit Keep All" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Edit Default policy" })).not.toBeInTheDocument();
    });

    it("picks a policy, or the default one as the default marker", async () => {
        const user = userEvent.setup();
        const onChange = await open(user, "simple");

        await user.click(screen.getByRole("option", { name: /Default policy/ }));
        expect(onChange).toHaveBeenCalledWith(DEFAULT_RETENTION_SENTINEL);
    });

    it("adds a policy from the foot of the list and picks it", async () => {
        const user = userEvent.setup();
        actions.createRetentionPolicy.mockResolvedValue({ success: true, data: { ...policy("weekly", "Weekly 8", { mode: "NONE" }), _count: undefined } });
        const onChange = await open(user);

        await user.click(screen.getByRole("button", { name: "New policy" }));
        const dialog = await screen.findByRole("dialog", { name: "New retention policy" });
        await user.type(within(dialog).getByLabelText("Name"), "Weekly 8");
        await user.click(within(dialog).getByRole("button", { name: "Create policy" }));

        await waitFor(() => expect(onChange).toHaveBeenCalledWith("weekly"));
        expect(actions.createRetentionPolicy).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly 8", config: { mode: "NONE" } }));
    });
});

describe("describeRetention", () => {
    it("puts a policy into a few words, and one it cannot read keeps everything", () => {
        expect(describeRetention(JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 30 } }))).toBe("Keeps the last 30");
        expect(describeRetention(JSON.stringify({ mode: "SMART", smart: { hourly: 24, daily: 7, weekly: 0, monthly: 12, yearly: 0 } }))).toBe("24 hourly, 7 daily, 12 monthly");
        expect(describeRetention("not json")).toBe("Keeps everything");
    });
});
