import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionPicker } from "@/components/dashboard/jobs/connection-picker";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import { PermissionsProvider } from "@/components/permissions/permissions-context";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const OPTIONS: AdapterOption[] = [
    { id: "pg", name: "Shop cluster", adapterId: "postgres", config: JSON.stringify({ host: "db.internal", port: 5432 }), lastStatus: "ONLINE" },
    { id: "my", name: "CRM", adapterId: "mysql", config: JSON.stringify({ host: "crm.internal", port: 3306 }), lastStatus: "OFFLINE" },
];

function renderPicker(props: Partial<React.ComponentProps<typeof ConnectionPicker>> = {}) {
    const onChange = vi.fn();
    render(<ConnectionPicker kind="database" options={OPTIONS} value="" onChange={onChange} placeholder="Pick a database connection" aria-label="Database" {...props} />);
    return onChange;
}

describe("connection picker", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("lists each connection with its type, where it points and a status that is not online, and picks one", async () => {
        const user = userEvent.setup();
        const onChange = renderPicker();

        await user.click(screen.getByRole("combobox", { name: "Database" }));

        expect(screen.getByText("Pick from Connections")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: /Shop cluster/ })).toHaveTextContent("PostgreSQL · db.internal:5432");
        expect(screen.getByRole("option", { name: /CRM/ })).toHaveTextContent("MySQL · crm.internal:3306 · Offline");

        await user.click(screen.getByRole("option", { name: /CRM/ }));
        expect(onChange).toHaveBeenCalledWith("my");
    });

    it("leaves out the connections other rows use already", async () => {
        const user = userEvent.setup();
        renderPicker({ kind: "destination", taken: ["my"], "aria-label": "Destination 1" });

        await user.click(screen.getByRole("combobox", { name: "Destination 1" }));

        expect(screen.getByRole("option", { name: /Shop cluster/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /CRM/ })).not.toBeInTheDocument();
    });

    it("adds a new destination from the foot of the list with the dialogs of the Connections page", async () => {
        const user = userEvent.setup();
        renderPicker({ kind: "destination", "aria-label": "Destination 1" });

        await user.click(screen.getByRole("combobox", { name: "Destination 1" }));
        await user.click(screen.getByRole("button", { name: "New destination" }));

        expect(await screen.findByRole("dialog", { name: "Add destination" })).toBeInTheDocument();
    });

    it("offers New beside the database field, where there is room for it", () => {
        renderPicker({ newBeside: true });

        expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    });

    it("offers no New to a viewer who may add sources but no destinations", async () => {
        const user = userEvent.setup();
        render(
            <PermissionsProvider permissions={["sources:write", "destinations:read"]}>
                <ConnectionPicker kind="destination" options={OPTIONS} value="" onChange={vi.fn()} placeholder="Pick a destination" aria-label="Destination 1" newBeside />
            </PermissionsProvider>
        );

        expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("combobox", { name: "Destination 1" }));
        expect(screen.queryByRole("button", { name: "New destination" })).not.toBeInTheDocument();
    });
});
