import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh }),
}));

import { DashboardRefresh } from "@/components/dashboard/widgets/dashboard-refresh";

function setVisibility(state: "visible" | "hidden", notify = true) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    if (notify) document.dispatchEvent(new Event("visibilitychange"));
}

describe("DashboardRefresh", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setVisibility("visible", false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("reloads every 30 seconds while nothing runs, so a scheduled run shows up without a reload", () => {
        render(<DashboardRefresh hasRunningJobs={false}><div /></DashboardRefresh>);

        vi.advanceTimersByTime(29_999);
        expect(refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("reloads every 3 seconds while a job runs", () => {
        render(<DashboardRefresh hasRunningJobs><div /></DashboardRefresh>);

        vi.advanceTimersByTime(9_000);
        expect(refresh).toHaveBeenCalledTimes(3);
    });

    it("reloads once right after the last run ends", () => {
        const { rerender } = render(<DashboardRefresh hasRunningJobs><div /></DashboardRefresh>);

        rerender(<DashboardRefresh hasRunningJobs={false}><div /></DashboardRefresh>);

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("stops in a hidden tab and catches up as soon as the tab is visible again", () => {
        render(<DashboardRefresh hasRunningJobs={false}><div /></DashboardRefresh>);

        act(() => setVisibility("hidden"));
        vi.advanceTimersByTime(120_000);
        expect(refresh).not.toHaveBeenCalled();

        act(() => setVisibility("visible"));
        expect(refresh).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(30_000);
        expect(refresh).toHaveBeenCalledTimes(2);
    });
});
