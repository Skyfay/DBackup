import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { TableDefaultsProvider } from "@/components/ui/table-defaults";
import type { TableDefaults, TablePreferences } from "@/lib/core/table-preferences";

interface Item {
    id: string;
    name: string;
}

const items: Item[] = Array.from({ length: 60 }, (_, index) => ({ id: `item-${index}`, name: `Item ${index}` }));
const columns: ColumnDef<Item>[] = [
    { accessorKey: "name", header: "Name" },
    { id: "size", header: "Size", cell: () => "1 MB" },
];

/** The rows of the table without its head. */
const rowCount = () => screen.getAllByRole("row").length - 1;

function renderTable(defaults: TableDefaults | null, initial?: TablePreferences | null, onChange = vi.fn()) {
    const table = (
        <DataTable variant="card" columns={columns} data={items} getRowId={(item) => item.id} columnLayout={initial === undefined ? undefined : { initial, onChange }} />
    );
    render(defaults ? <TableDefaultsProvider defaults={defaults}>{table}</TableDefaultsProvider> : table);
    return onChange;
}

describe("the rows per page and row height of a table", () => {
    beforeAll(() => {
        // Radix Select captures the pointer and scrolls the picked option into view, which jsdom does not implement.
        Element.prototype.hasPointerCapture = () => false;
        Element.prototype.releasePointerCapture = () => {};
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("starts with the rows per page of the profile", () => {
        renderTable({ pageSize: 10, density: "compact" });

        expect(rowCount()).toBe(10);
        expect(screen.getByText("Page 1 of 6")).toBeInTheDocument();
    });

    it("starts with 20 rows outside the dashboard, where no profile is read", () => {
        renderTable(null);

        expect(rowCount()).toBe(20);
    });

    it("keeps the rows per page a table with a column layout was switched to, and follows the profile again when switched back", async () => {
        const user = userEvent.setup();
        const onChange = renderTable({ pageSize: 10, density: "comfortable" }, null);

        await user.click(screen.getByRole("combobox"));
        await user.click(await screen.findByRole("option", { name: "50" }));
        expect(rowCount()).toBe(50);
        await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 })));

        await user.click(screen.getByRole("combobox"));
        await user.click(await screen.findByRole("option", { name: "10" }));
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("goes back to the rows per page of the profile on Reset", async () => {
        const user = userEvent.setup();
        const onChange = renderTable({ pageSize: 10, density: "comfortable" }, { order: ["name", "size"], hidden: [], pageSize: 50 });

        expect(rowCount()).toBe(50);
        await user.click(screen.getByRole("button", { name: /Columns/ }));
        await user.click(screen.getByRole("button", { name: "Reset" }));

        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(rowCount()).toBe(10);
    });
});
