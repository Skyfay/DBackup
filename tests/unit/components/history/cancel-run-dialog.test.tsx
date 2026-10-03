import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const cancelRun = vi.fn();
vi.mock("@/components/dashboard/history/run-actions", () => ({ cancelRun: (id: string) => cancelRun(id) }));

const { CancelRunDialog } = await import("@/components/dashboard/history/cancel-run-dialog");

const backup = { id: "r1", name: "Shop nightly", type: "Backup", status: "Running" as const };

describe("cancelling a run", () => {
    beforeEach(() => {
        cancelRun.mockReset().mockResolvedValue(true);
    });

    it("asks first, and a slip of the mouse keeps the run going", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const onCancelled = vi.fn();
        render(<CancelRunDialog run={backup} onClose={onClose} onCancelled={onCancelled} />);

        expect(screen.getByRole("alertdialog", { name: "Cancel Shop nightly?" })).toHaveTextContent("The run stops where it is");
        await user.click(screen.getByRole("button", { name: "Keep it running" }));

        expect(onClose).toHaveBeenCalled();
        expect(cancelRun).not.toHaveBeenCalled();
        expect(onCancelled).not.toHaveBeenCalled();
    });

    it("stops the run once confirmed", async () => {
        const user = userEvent.setup();
        const onCancelled = vi.fn();
        render(<CancelRunDialog run={backup} onClose={vi.fn()} onCancelled={onCancelled} />);

        await user.click(screen.getByRole("button", { name: "Cancel run" }));

        expect(cancelRun).toHaveBeenCalledExactlyOnceWith("r1");
        expect(onCancelled).toHaveBeenCalled();
    });

    it("says that a restore stops halfway through its database, and that a waiting run only leaves the queue", () => {
        const { rerender } = render(<CancelRunDialog run={{ ...backup, type: "Restore" }} onClose={vi.fn()} onCancelled={vi.fn()} />);
        expect(screen.getByRole("alertdialog")).toHaveTextContent("may be left half restored");

        rerender(<CancelRunDialog run={{ ...backup, status: "Pending" }} onClose={vi.fn()} onCancelled={vi.fn()} />);
        expect(screen.getByRole("alertdialog")).toHaveTextContent("leaves the queue");
        expect(screen.getByRole("button", { name: "Keep it waiting" })).toBeInTheDocument();
    });
});
