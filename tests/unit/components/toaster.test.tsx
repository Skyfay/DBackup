import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark" }) }));

describe("toasts", () => {
    beforeAll(() => {
        // Sonner captures the pointer on every press to follow a swipe, which jsdom does not implement.
        Element.prototype.setPointerCapture = vi.fn();
    });

    afterEach(() => {
        act(() => {
            toast.dismiss();
        });
        vi.restoreAllMocks();
    });

    it("copies what an error says, its reason included, so it can be pasted instead of photographed", async () => {
        const user = userEvent.setup();
        const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
        render(<Toaster />);

        act(() => {
            toast.error("Cannot turn this into a destination", { description: "It is used as a directory source in Shop nightly." });
        });
        await user.click(await screen.findByRole("button", { name: "Copy the message" }));

        expect(writeText).toHaveBeenCalledWith("Cannot turn this into a destination\nIt is used as a directory source in Shop nightly.");
        expect(await screen.findByRole("button", { name: "Message copied" })).toBeInTheDocument();
    });

    it("offers Close on every toast and Copy only where something went wrong", async () => {
        render(<Toaster />);

        act(() => {
            toast.success("Job deleted");
        });

        expect(await screen.findByRole("button", { name: "Close toast" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Copy the message" })).not.toBeInTheDocument();
    });
});
