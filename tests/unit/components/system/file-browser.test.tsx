import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileBrowserDialog } from "@/components/system/file-browser-dialog";
import { SQLITE_FILES, fits, parentOf, pathSegments, visibleEntries, type FileEntry } from "@/components/system/file-browser-model";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ENTRIES: FileEntry[] = [
    { name: ".cache", type: "directory", path: "/data/sqlite/.cache" },
    { name: "archive", type: "directory", path: "/data/sqlite/archive" },
    { name: "notes.txt", type: "file", path: "/data/sqlite/notes.txt", size: 2048 },
    { name: "shop.db", type: "file", path: "/data/sqlite/shop.db", size: 48_200_000 },
];

describe("file browser model", () => {
    it("marks the files a field takes by their extension", () => {
        expect(fits("shop.DB", SQLITE_FILES)).toBe(true);
        expect(fits("shop.db-wal", SQLITE_FILES)).toBe(false);
        expect(fits("anything", undefined)).toBe(true);
    });

    it("turns a path into clickable parts and finds its folder", () => {
        expect(pathSegments("/data/sqlite")).toEqual([
            { name: "data", path: "/data" },
            { name: "sqlite", path: "/data/sqlite" },
        ]);
        expect(pathSegments("/")).toEqual([]);
        expect(parentOf("/data/sqlite/shop.db")).toBe("/data/sqlite");
        expect(parentOf("/data/")).toBe("/");
    });

    it("leaves out hidden entries, files while a folder is picked, and what the filter does not match", () => {
        const names = (list: FileEntry[]) => list.map((entry) => entry.name);
        expect(names(visibleEntries(ENTRIES, { showHidden: false, filter: "", selectionType: "file" }))).toEqual(["archive", "notes.txt", "shop.db"]);
        expect(names(visibleEntries(ENTRIES, { showHidden: true, filter: "", selectionType: "directory" }))).toEqual([".cache", "archive"]);
        expect(names(visibleEntries(ENTRIES, { showHidden: false, filter: "SHO", selectionType: "file" }))).toEqual(["shop.db"]);
    });
});

describe("file browser dialog", () => {
    const listing = { currentPath: "/data/sqlite", parentPath: "/data", entries: ENTRIES };
    const mockFetch = vi.fn((url: string) => {
        const path = new URL(url, "http://localhost").searchParams.get("path");
        const body = path === "/data/sqlite" ? { success: true, data: listing } : { success: false, error: "Not a directory" };
        return Promise.resolve({ ok: body.success, json: () => Promise.resolve(body) } as Response);
    });

    beforeEach(() => {
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    it("opens at the file in the field, picked, and hands it back", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(
            <FileBrowserDialog open onOpenChange={vi.fn()} onSelect={onSelect} initialPath="/data/sqlite/shop.db" title="Pick the database file" accept={SQLITE_FILES} />
        );

        expect(await screen.findByText("/data/sqlite/shop.db")).toBeInTheDocument();
        expect(screen.getByText("This machine · SQLite file")).toBeInTheDocument();
        // Hidden folders stay out until asked for.
        expect(screen.queryByRole("button", { name: /\.cache/ })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Use this file" }));
        expect(onSelect).toHaveBeenCalledWith("/data/sqlite/shop.db");
    });

    it("picks the folder it is in when a folder is wanted, and shows no files there", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<FileBrowserDialog open onOpenChange={vi.fn()} onSelect={onSelect} initialPath="/data/sqlite" selectionType="directory" title="Pick the folder" />);

        await waitFor(() => expect(screen.getByRole("button", { name: /archive/ })).toBeInTheDocument());
        expect(screen.queryByRole("button", { name: /shop\.db/ })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Use this folder" }));
        expect(onSelect).toHaveBeenCalledWith("/data/sqlite");
    });
});
