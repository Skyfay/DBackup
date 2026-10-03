import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EncryptionKeyPicker } from "@/components/dashboard/jobs/encryption-key-picker";
import { NO_ENCRYPTION, type EncryptionOption } from "@/components/dashboard/jobs/job-form-schema";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { freeKeyName } from "@/components/settings/encryption-key-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const actions = vi.hoisted(() => ({ createEncryptionProfile: vi.fn() }));
vi.mock("@/app/actions/backup/encryption", () => actions);

const KEYS: EncryptionOption[] = [
    { id: "spare", name: "Spare key", description: null, jobCount: 0 },
    { id: "backup", name: "Backup key", description: "Production", jobCount: 2 },
];

function renderPicker(value = NO_ENCRYPTION, keys = KEYS, permissions?: string[]) {
    const onChange = vi.fn();
    const picker = <EncryptionKeyPicker keys={keys} value={value} onChange={onChange} aria-label="Key" />;
    render(permissions ? <PermissionsProvider permissions={permissions}>{picker}</PermissionsProvider> : picker);
    return onChange;
}

describe("encryption key picker", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => vi.clearAllMocks());

    it("lists No encryption first and then the keys of the Vault with how many jobs use each, and picks one", async () => {
        const user = userEvent.setup();
        const onChange = renderPicker();

        const trigger = screen.getByRole("combobox", { name: "Key" });
        expect(trigger).toHaveTextContent("No encryption");
        await user.click(trigger);

        expect(screen.getByText("Pick from the Vault")).toBeInTheDocument();
        const options = screen.getAllByRole("option");
        expect(options.map((option) => option.textContent)).toEqual([
            expect.stringContaining("No encryption"),
            expect.stringContaining("Backup key"),
            expect.stringContaining("Spare key"),
        ]);
        expect(options[1]).toHaveTextContent("Production · Used by 2 jobs");
        expect(options[2]).toHaveTextContent("Not used yet");

        await user.click(screen.getByRole("option", { name: /Spare key/ }));
        expect(onChange).toHaveBeenCalledWith("spare");
    });

    it("turns encryption off with the entry at the top", async () => {
        const user = userEvent.setup();
        const onChange = renderPicker("backup");

        expect(screen.getByRole("combobox", { name: "Key" })).toHaveTextContent("Backup key");
        await user.click(screen.getByRole("combobox", { name: "Key" }));
        await user.click(screen.getByRole("option", { name: /No encryption/ }));

        expect(onChange).toHaveBeenCalledWith(NO_ENCRYPTION);
    });

    it("says when the Vault holds no key yet", async () => {
        const user = userEvent.setup();
        renderPicker(NO_ENCRYPTION, []);

        await user.click(screen.getByRole("combobox", { name: "Key" }));

        expect(screen.getByText("The Vault holds no key yet")).toBeInTheDocument();
    });

    it("makes a key from the foot of the list with a free name and picks it", async () => {
        const user = userEvent.setup();
        actions.createEncryptionProfile.mockResolvedValue({ success: true, data: { id: "new", name: "Backup key 2", description: null } });
        const onChange = renderPicker();

        await user.click(screen.getByRole("combobox", { name: "Key" }));
        await user.click(screen.getByRole("button", { name: "New key" }));
        const dialog = await screen.findByRole("dialog", { name: "New key" });
        expect(within(dialog).getByLabelText("Name")).toHaveValue("Backup key 2");
        await user.click(within(dialog).getByRole("button", { name: "Create key" }));

        await waitFor(() => expect(onChange).toHaveBeenCalledWith("new"));
        expect(actions.createEncryptionProfile).toHaveBeenCalledWith("Backup key 2", undefined);
    });

    it("offers no New to a viewer who may only read the Vault", async () => {
        const user = userEvent.setup();
        renderPicker(NO_ENCRYPTION, KEYS, ["vault:read", "jobs:write"]);

        expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("combobox", { name: "Key" }));
        expect(screen.getByRole("option", { name: /Backup key/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New key" })).not.toBeInTheDocument();
    });

    it("keeps a new key from taking the name of one in the Vault", async () => {
        const user = userEvent.setup();
        renderPicker();

        await user.click(screen.getByRole("button", { name: "New" }));
        const dialog = await screen.findByRole("dialog", { name: "New key" });
        const name = within(dialog).getByLabelText("Name");
        await user.clear(name);
        await user.type(name, "Spare key");
        await user.click(within(dialog).getByRole("button", { name: "Create key" }));

        expect(within(dialog).getByText("The Vault holds a key by this name already.")).toBeInTheDocument();
        expect(actions.createEncryptionProfile).not.toHaveBeenCalled();
    });
});

describe("freeKeyName", () => {
    it("counts up past the names the Vault holds already", () => {
        expect(freeKeyName([])).toBe("Backup key");
        expect(freeKeyName(["Backup key", "Backup key 2"])).toBe("Backup key 3");
    });
});
