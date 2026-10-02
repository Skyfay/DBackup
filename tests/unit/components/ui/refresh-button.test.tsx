import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RefreshButton } from "@/components/ui/refresh-button";

describe("the button that loads a list again", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("turns for a full turn after a click and ignores the clicks meanwhile, so it cannot be fired again and again", async () => {
        const onRefresh = vi.fn();
        render(<RefreshButton onRefresh={onRefresh} label="Refresh" />);
        const button = screen.getByRole("button", { name: "Refresh" });

        await act(async () => {
            fireEvent.click(button);
        });
        fireEvent.click(button);
        fireEvent.click(button);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(button).toHaveAttribute("aria-busy", "true");

        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        expect(button).toHaveAttribute("aria-busy", "false");

        await act(async () => {
            fireEvent.click(button);
        });
        expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it("keeps turning while a slow load runs and stops on a whole turn after it", async () => {
        let finish: () => void = () => undefined;
        const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
            finish = resolve;
        }));
        render(<RefreshButton onRefresh={onRefresh} label="Refresh" />);
        const button = screen.getByRole("button", { name: "Refresh" });

        await act(async () => {
            fireEvent.click(button);
        });
        await act(async () => {
            vi.advanceTimersByTime(1500);
            finish();
        });
        expect(button).toHaveAttribute("aria-busy", "true");

        await act(async () => {
            vi.advanceTimersByTime(499);
        });
        expect(button).toHaveAttribute("aria-busy", "true");
        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        expect(button).toHaveAttribute("aria-busy", "false");
    });

    it("turns while a load runs that started elsewhere", () => {
        render(<RefreshButton onRefresh={vi.fn()} busy label="Refresh" />);

        expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute("aria-busy", "true");
    });
});
