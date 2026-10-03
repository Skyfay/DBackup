import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectoryTree } from "@/components/dashboard/jobs/directory-tree";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const LEVELS: Record<string, { name: string; path: string }[]> = {
    "": [{ name: "data", path: "data" }, { name: "logs", path: "logs" }],
    data: [{ name: "cache", path: "data/cache" }],
};

describe("the folder tree of a folder source", () => {
    beforeEach(() => {
        global.fetch = vi.fn((url: string) => {
            const path = new URL(url, "http://localhost").searchParams.get("path") ?? "";
            return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { entries: LEVELS[path] ?? [] } }) } as Response);
        }) as unknown as typeof fetch;
    });

    it("names every button and box for a screen reader, and picks a folder", async () => {
        const user = userEvent.setup();
        const onRowsChange = vi.fn();
        render(<DirectoryTree configId="nas" rows={[]} onRowsChange={onRowsChange} />);

        await user.click(await screen.findByRole("checkbox", { name: "Back up data" }));
        expect(onRowsChange).toHaveBeenCalledWith([{ path: "data", excludePatterns: [], excludePatternPresetIds: [] }]);
        expect(screen.getByRole("checkbox", { name: "Back up everything" })).toBeInTheDocument();
    });

    it("opens a folder by its named button and says it is open", async () => {
        const user = userEvent.setup();
        render(<DirectoryTree configId="nas" rows={[]} onRowsChange={vi.fn()} />);

        const open = await screen.findByRole("button", { name: "Open data" });
        expect(open).toHaveAttribute("aria-expanded", "false");
        await user.click(open);

        expect(await screen.findByRole("checkbox", { name: "Back up cache" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Close data" })).toHaveAttribute("aria-expanded", "true");
    });
});
