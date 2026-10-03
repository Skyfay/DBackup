import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

const mocks = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));

const rows = [{ id: "a", name: "First" }, { id: "b", name: "Second" }];

function linkTo(query: string) {
    mocks.params = new URLSearchParams(query);
    window.history.replaceState(null, "", `/dashboard/vault?${query}`);
}

describe("opening the record a link names", () => {
    beforeEach(() => {
        linkTo("");
    });

    it("waits for the list, opens the record and takes the name off the address", () => {
        const open = vi.fn();
        linkTo("tab=encryption&open=b");
        const { rerender } = renderHook(({ list }) => useOpenFromLink(list, open), { initialProps: { list: null as typeof rows | null } });

        expect(open).not.toHaveBeenCalled();

        rerender({ list: rows });

        expect(open).toHaveBeenCalledExactlyOnceWith(rows[1]);
        expect(window.location.search).toBe("?tab=encryption");
    });

    it("opens a record linked while the page is already open, and the same one again later", () => {
        const open = vi.fn();
        const { rerender } = renderHook(() => useOpenFromLink(rows, open));

        linkTo("open=a");
        rerender();
        // Next.js reports the address without the name once the hook took it off.
        mocks.params = new URLSearchParams();
        rerender();
        linkTo("open=a");
        rerender();

        expect(open).toHaveBeenCalledTimes(2);
        expect(open).toHaveBeenLastCalledWith(rows[0]);
    });

    it("skips a record the list does not hold, like one deleted since", () => {
        const open = vi.fn();
        linkTo("job=gone");

        renderHook(() => useOpenFromLink(rows, open, "job"));

        expect(open).not.toHaveBeenCalled();
        expect(window.location.search).toBe("");
    });
});
