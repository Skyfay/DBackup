import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListChecks } from "lucide-react";
import { CloneDialog, freeCopyName } from "@/components/ui/clone-dialog";

function renderDialog(existingNames: string[], onConfirm = vi.fn(() => Promise.resolve())) {
    render(
        <CloneDialog
            title="Clone job"
            from="Shop nightly"
            noun="job"
            existingNames={existingNames}
            facts={[{ icon: ListChecks, text: "The copy backs up the same source." }]}
            confirmLabel="Clone job"
            onConfirm={onConfirm}
            onClose={vi.fn()}
        />
    );
    return onConfirm;
}

describe("cloning an entry", () => {
    it("names a copy like the server does, counting up while a name is taken", () => {
        expect(freeCopyName("NAS", "Copy", [])).toBe("NAS (Copy)");
        expect(freeCopyName("NAS", "Source", ["NAS (Source)", "nas (source 2)"])).toBe("NAS (Source 3)");
    });

    it("starts with a free name, selected, so Enter clones under it and typing replaces it", async () => {
        const user = userEvent.setup();
        const onConfirm = renderDialog(["Shop nightly", "Shop nightly (Copy)"]);

        const field = screen.getByRole("textbox", { name: "Name" });
        expect(field).toHaveValue("Shop nightly (Copy 2)");
        await waitFor(() => expect(field).toHaveFocus());
        expect([(field as HTMLInputElement).selectionStart, (field as HTMLInputElement).selectionEnd]).toEqual([0, "Shop nightly (Copy 2)".length]);
        expect(screen.getByText("From Shop nightly")).toBeInTheDocument();

        await user.keyboard("{Enter}");
        expect(onConfirm).toHaveBeenCalledWith("Shop nightly (Copy 2)");
    });

    it("refuses a name that is taken, whatever its case", async () => {
        const user = userEvent.setup();
        const onConfirm = renderDialog(["Shop nightly"]);

        const field = screen.getByRole("textbox", { name: "Name" });
        await user.clear(field);
        await user.type(field, "shop NIGHTLY");

        expect(screen.getByText("A job by this name exists already.")).toBeInTheDocument();
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("button", { name: "Clone job" })).toBeDisabled();
        await user.keyboard("{Enter}");
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
