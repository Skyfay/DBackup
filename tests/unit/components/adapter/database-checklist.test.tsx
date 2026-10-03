import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatabaseChecklist } from "@/components/adapter/database-checklist";

const GB = 1024 ** 3;
const DATABASES = [
    { name: "shop", sizeInBytes: 3 * GB, tableCount: 84 },
    { name: "shop_archive", sizeInBytes: 8 * GB, tableCount: 84 },
    { name: "crm", sizeInBytes: 1 * GB, tableCount: 41 },
    { name: "wiki", sizeInBytes: GB / 2, tableCount: 1 },
];

function serve(stats = true) {
    const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    global.fetch = vi.fn((url: string) => {
        if (url === "/api/adapters/src-1/databases") return json({ success: true, databases: DATABASES.map((database) => database.name) });
        if (url === "/api/adapters/database-stats") return json(stats ? { success: true, databases: DATABASES } : { success: false, message: "Not supported" });
        return json({ success: false, error: `Unexpected ${url}` });
    }) as unknown as typeof fetch;
}

function Picker({ initial = [], onUseAll }: { initial?: string[]; onUseAll?: () => void }) {
    const [value, setValue] = useState<string[]>(initial);
    return (
        <>
            <DatabaseChecklist sourceId="src-1" value={value} onChange={setValue} onUseAll={onUseAll} />
            <output data-testid="value">{[...value].sort().join(",")}</output>
        </>
    );
}

const picked = () => screen.getByTestId("value").textContent;

describe("database checklist", () => {
    beforeEach(() => serve());

    it("picks every database with the checkbox of the head and clears them again", async () => {
        const user = userEvent.setup();
        render(<Picker />);

        await user.click(await screen.findByRole("checkbox", { name: "Pick every database" }));
        expect(picked()).toBe("crm,shop,shop_archive,wiki");

        await user.click(screen.getByRole("button", { name: "Clear" }));
        expect(picked()).toBe("");
    });

    it("picks only what the search shows, and says how many picked ones it hides", async () => {
        const user = userEvent.setup();
        render(<Picker initial={["crm"]} />);

        await user.type(await screen.findByRole("textbox", { name: "Search databases" }), "shop");
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
        expect(screen.getByText(/2 shown · 1 picked/)).toHaveTextContent("1 of them hidden by the search");

        await user.click(screen.getByRole("button", { name: "Pick the 2 shown" }));
        expect(picked()).toBe("crm,shop,shop_archive");
    });

    it("shows how big each database is, adds up the picked ones and sorts by size", async () => {
        const user = userEvent.setup();
        render(<Picker initial={["shop", "crm"]} />);

        expect(await screen.findByText("2 of 4 picked")).toBeInTheDocument();
        expect(await screen.findByText(/· 4 GB of 12.5 GB/)).toBeInTheDocument();
        expect(within(screen.getAllByRole("listitem")[1]).getByText("84 tables")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Sorted by name, sort by size" }));
        expect(screen.getAllByRole("listitem").map((item) => item.textContent?.split(/\d/)[0])).toEqual(["shop_archive", "shop", "crm", "wiki"]);
    });

    it("works without sizes for a kind that cannot tell them", async () => {
        serve(false);
        render(<Picker initial={["shop"]} />);

        expect(await screen.findByText("1 of 4 picked")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /sort by size/ })).not.toBeInTheDocument();
    });

    it("offers All databases once every one is picked, which also takes new ones", async () => {
        const user = userEvent.setup();
        const onUseAll = vi.fn();
        render(<Picker initial={["shop", "shop_archive", "crm", "wiki"]} onUseAll={onUseAll} />);

        expect(await screen.findByText(/Every database is picked/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Use All databases" }));
        expect(onUseAll).toHaveBeenCalled();
    });

    it("keeps a picked database the server no longer has on top, so it can be unticked", async () => {
        const user = userEvent.setup();
        render(<Picker initial={["old_reports", "crm"]} />);

        const first = (await screen.findAllByRole("listitem"))[0];
        expect(first).toHaveTextContent("old_reports");
        expect(first).toHaveTextContent("Not on the server");
        expect(screen.getByText(/1 no longer on the server/)).toBeInTheDocument();

        await user.click(within(first).getByRole("checkbox"));
        expect(picked()).toBe("crm");
    });

    it("does not save the form around it when Enter is pressed in the search", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <Picker />
                <button type="submit">Create job</button>
            </form>
        );

        await user.type(await screen.findByRole("textbox", { name: "Search databases" }), "shop{Enter}");
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
