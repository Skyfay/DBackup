import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisibleInterval } from "@/hooks/use-visible-interval";

function showTab(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("polling only while the tab is visible", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        showTab("visible");
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (document as { visibilityState?: unknown }).visibilityState;
    });

    it("ticks every interval while the tab is visible", () => {
        const tick = vi.fn();
        renderHook(() => useVisibleInterval(tick, 10_000));

        vi.advanceTimersByTime(30_000);

        expect(tick).toHaveBeenCalledTimes(3);
    });

    it("asks nothing while the tab is hidden, and once at once when it shows again", () => {
        const tick = vi.fn();
        renderHook(() => useVisibleInterval(tick, 10_000));

        showTab("hidden");
        vi.advanceTimersByTime(60_000);
        expect(tick).not.toHaveBeenCalled();

        showTab("visible");
        expect(tick).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(10_000);
        expect(tick).toHaveBeenCalledTimes(2);
    });

    it("does nothing while it is off, like Settings without a running task", () => {
        const tick = vi.fn();
        renderHook(() => useVisibleInterval(tick, 3000, false));

        vi.advanceTimersByTime(30_000);

        expect(tick).not.toHaveBeenCalled();
    });

    it("calls the newest tick without starting the timer again", () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(({ tick }) => useVisibleInterval(tick, 10_000), { initialProps: { tick: first } });

        vi.advanceTimersByTime(5_000);
        rerender({ tick: second });
        vi.advanceTimersByTime(5_000);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
