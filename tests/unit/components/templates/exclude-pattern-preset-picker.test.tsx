import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const actions = vi.hoisted(() => ({ getExcludePatternPresets: vi.fn() }));
vi.mock("@/app/actions/templates", () => actions);
// The preset dialog has a page of its own to test, here it only has to open.
vi.mock("@/components/settings/templates/exclude-pattern-preset-dialog", () => ({
    ExcludePatternPresetDialog: ({ open, preset }: { open: boolean; preset?: { name: string } }) => (open ? <div role="dialog">{preset ? `Edit ${preset.name}` : "New preset"}</div> : null),
}));

const { ExcludePatternPresetPicker } = await import("@/components/templates/exclude-pattern-preset-picker");

const preset = (id: string, name: string, patterns: string[], isSystem = false) => ({
    id, name, description: null, patterns: JSON.stringify(patterns), groups: "[]", excludedGroupPatterns: "[]",
    isDefault: false, isSystem, createdAt: new Date("2026-09-01T00:00:00.000Z"), updatedAt: new Date("2026-09-01T00:00:00.000Z"),
});

const PRESETS = [
    preset("node", "Node projects", ["node_modules/**", ".cache/**", "*.log"]),
    preset("tmp", "Temporary files", ["*.tmp"]),
    preset("system", "Shipped", ["*.swp"], true),
];

function renderPicker(permissions: string[], props: Partial<React.ComponentProps<typeof ExcludePatternPresetPicker>> = {}) {
    const onChange = vi.fn();
    render(
        <PermissionsProvider permissions={permissions}>
            <ExcludePatternPresetPicker value={null} onChange={onChange} placeholder="Add an exclude preset" {...props} />
        </PermissionsProvider>
    );
    return onChange;
}

describe("the exclude presets of a folder", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        actions.getExcludePatternPresets.mockResolvedValue({ success: true, data: PRESETS });
    });

    it("lists what each preset leaves out, without the ones the folder links already, and links the picked one", async () => {
        const user = userEvent.setup();
        const onChange = renderPicker([PERMISSIONS.TEMPLATES.WRITE], { usedIds: ["tmp"] });

        const trigger = screen.getByRole("combobox");
        await waitFor(() => expect(trigger).toHaveTextContent("Add an exclude preset"));
        await user.click(trigger);

        expect(screen.getByRole("option", { name: /Node projects/ })).toHaveTextContent("node_modules/**, .cache/** and 1 more");
        expect(screen.queryByRole("option", { name: /Temporary files/ })).not.toBeInTheDocument();

        await user.click(screen.getByRole("option", { name: /Node projects/ }));
        expect(onChange).toHaveBeenCalledWith("node");
    });

    it("offers Edit and New only to someone who may write templates, and never Edit on a preset that ships with DBackup", async () => {
        const user = userEvent.setup();
        renderPicker([PERMISSIONS.TEMPLATES.WRITE]);
        await user.click(await screen.findByRole("combobox"));

        expect(screen.getByRole("button", { name: "Edit Node projects" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Edit Shipped" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "New preset" }));
        expect(screen.getByRole("dialog")).toHaveTextContent("New preset");
    });

    it("leaves Edit and New out for a viewer who may only read", async () => {
        const user = userEvent.setup();
        renderPicker([PERMISSIONS.JOBS.WRITE]);
        await waitFor(() => expect(screen.getByRole("combobox")).not.toBeDisabled());
        await user.click(screen.getByRole("combobox"));

        expect(screen.getByRole("option", { name: /Node projects/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New preset" })).not.toBeInTheDocument();
    });

    it("shows what the linked preset leaves out under the field", async () => {
        renderPicker([], { value: "node" });

        expect(await screen.findByText("node_modules/**")).toBeInTheDocument();
        expect(screen.getByText("*.log")).toBeInTheDocument();
    });
});
