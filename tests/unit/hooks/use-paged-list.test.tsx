import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePagedList, type PagedQuery } from "@/hooks/use-paged-list";

describe("a paged list that loads from the server", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("asks for the first page at once and says when it arrived", async () => {
        const load = vi.fn(async (_query: PagedQuery) => ({ rows: ["a", "b"], total: 2 }));
        const { result } = renderHook(() => usePagedList<string>({ load, enabled: true, pollMs: 0 }));

        expect(result.current.loaded).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(load).toHaveBeenCalledTimes(1);
        expect(result.current.loaded).toBe(true);
        expect(result.current.rows).toEqual(["a", "b"]);
    });

    it("waits briefly after a change of the filters, which typing in the search makes on every key", async () => {
        const load = vi.fn(async (_query: PagedQuery) => ({ rows: [], total: 0 }));
        const { result } = renderHook(() => usePagedList<string>({ load, enabled: true, pollMs: 0 }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        act(() => result.current.onColumnFiltersChange([{ id: "run", value: "nightly" }]));
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
        expect(load).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("counts as loaded after a failed first page too, so the table does not wait forever", async () => {
        const load = vi.fn(async (_query: PagedQuery): Promise<{ rows: string[]; total: number }> => {
            throw new Error("The runs request failed with 500");
        });
        const { result } = renderHook(() => usePagedList<string>({ load, enabled: true, pollMs: 0 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(result.current.loaded).toBe(true);
        expect(result.current.rows).toEqual([]);
    });
});
