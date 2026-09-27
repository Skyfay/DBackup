import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/auth/table-preferences", () => ({ saveTableDefaults: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { saveTableDefaults } from "@/app/actions/auth/table-preferences";
import { TableDefaultsForm } from "@/components/settings/table-defaults-form";
import { TableDefaultsProvider } from "@/components/ui/table-defaults";

function renderForm() {
    render(
        <TableDefaultsProvider defaults={{ pageSize: 50, density: "comfortable" }}>
            <TableDefaultsForm />
        </TableDefaultsProvider>
    );
}

describe("the table defaults of the profile", () => {
    it("shows what the profile holds and saves a new row height with the rows per page it had", async () => {
        vi.mocked(saveTableDefaults).mockResolvedValue({ success: true });
        const user = userEvent.setup();
        renderForm();

        expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveTextContent("50");
        await user.click(screen.getByRole("tab", { name: "Compact" }));

        expect(saveTableDefaults).toHaveBeenCalledWith({ pageSize: 50, density: "compact" });
        await waitFor(() => expect(screen.getByRole("tab", { name: "Compact" })).toHaveAttribute("aria-selected", "true"));
    });

    it("goes back to what was saved when saving fails", async () => {
        vi.mocked(saveTableDefaults).mockResolvedValue({ success: false, error: "The defaults could not be saved" });
        const user = userEvent.setup();
        renderForm();

        await user.click(screen.getByRole("tab", { name: "Compact" }));

        await waitFor(() => expect(screen.getByRole("tab", { name: "Comfortable" })).toHaveAttribute("aria-selected", "true"));
    });
});
