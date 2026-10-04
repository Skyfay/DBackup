import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

describe("dialog forms", () => {
    it("saves a form in a dialog without also submitting the form the dialog was opened from", async () => {
        const outer = vi.fn((event: React.FormEvent) => event.preventDefault());
        const inner = vi.fn((event: React.FormEvent) => event.preventDefault());
        render(
            <form onSubmit={outer}>
                <Dialog open>
                    <DialogContent>
                        <DialogTitle>New schedule preset</DialogTitle>
                        <DialogDescription>A schedule jobs can follow</DialogDescription>
                        <form onSubmit={inner}>
                            <button type="submit">Create preset</button>
                        </form>
                    </DialogContent>
                </Dialog>
            </form>
        );

        await userEvent.setup().click(screen.getByRole("button", { name: "Create preset" }));

        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
    });
});
