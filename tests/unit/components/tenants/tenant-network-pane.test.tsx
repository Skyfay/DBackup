import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkCell } from "@/components/dashboard/tenants/tenant-columns";
import { TenantEditDialog } from "@/components/dashboard/tenants/tenant-edit-dialog";
import { NetworkPane, rangeDraft } from "@/components/dashboard/tenants/tenant-network-pane";
import type { TenantListRow } from "@/components/dashboard/tenants/tenant-words";
import { ALL_ALLOWED } from "@/lib/tenant/allowances";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const setTenantNetwork = vi.fn();
vi.mock("@/app/actions/tenant/tenant", () => ({
    renameTenant: vi.fn(),
    setTenantSharing: vi.fn(),
    setTenantAllowances: vi.fn(),
    setTenantNetwork: (...args: unknown[]) => setTenantNetwork(...args),
}));
vi.mock("@/app/actions/tenant/tenant-on-demand", () => ({
    getTenantOnDemand: vi.fn(async () => ({ success: true, data: { name: "Acme", perDay: null, overrides: [] } })),
    setTenantOnDemand: vi.fn(),
    followTenantOnDemand: vi.fn(),
}));
vi.mock("@/app/actions/tenant/members", () => ({ getTenantMembers: vi.fn(async () => ({ success: true, data: { members: [], accounts: [], groups: [] } })), setTenantMember: vi.fn(), setPlatformAdmin: vi.fn() }));

Element.prototype.scrollIntoView = vi.fn();

const ACME: TenantListRow = {
    id: "t-acme", name: "Acme", isHome: false, sharesWithCustomers: false, logo: null, members: 1, connections: 0, jobs: 1, createdAt: "2026-10-01T00:00:00.000Z", databases: 0, health: null,
    allowances: ALL_ALLOWED, provided: { destinations: 0, channels: 0 }, gives: { destinations: 0, channels: 0 }, onDemand: { perDay: null, own: 0 },
    network: { blocks: false, allowed: [] },
};

/** The pane with the state the dialog keeps for it. */
function Pane({ initial, disabled = false }: { initial: TenantListRow["network"]; disabled?: boolean }) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <NetworkPane tenant={{ name: "Acme" }} value={value} onChange={setValue} disabled={disabled} />
            <output data-testid="value">{JSON.stringify(value)}</output>
        </>
    );
}

const valueOf = () => JSON.parse(screen.getByTestId("value").textContent ?? "{}");

describe("the Network part of a tenant", () => {
    beforeEach(() => {
        setTenantNetwork.mockReset();
    });

    it("switches the block of the local network and says what it means", async () => {
        const user = userEvent.setup();
        render(<Pane initial={{ blocks: false, allowed: [] }} />);

        const block = screen.getByRole("switch", { name: "Block the local network" });
        expect(block).not.toBeChecked();
        expect(screen.getByText(/the connections of Acme reach the network of the server DBackup runs on/)).toBeInTheDocument();

        await user.click(block);
        expect(valueOf()).toEqual({ blocks: true, allowed: [] });
        expect(screen.getByText("None, Acme reaches no address of the local network.")).toBeInTheDocument();
    });

    it("checks a range as it is typed and adds it in its short form", async () => {
        const user = userEvent.setup();
        render(<Pane initial={{ blocks: true, allowed: [] }} />);

        const field = screen.getByRole("textbox", { name: "Range to allow" });
        const add = screen.getByRole("button", { name: "Add" });
        expect(add).toBeDisabled();

        await user.type(field, "10.10.10.5/24");
        expect(screen.getByText("10.10.10.5/24 has bits set after its prefix. Did you mean 10.10.10.0/24?")).toBeInTheDocument();
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(add).toBeDisabled();

        await user.clear(field);
        await user.type(field, "FD00:1::/64");
        expect(add).toBeEnabled();
        await user.click(add);
        expect(valueOf().allowed).toEqual(["fd00:1::/64"]);
        expect(field).toHaveValue("");

        // Enter adds too, a single address as the range of itself.
        await user.type(field, "10.0.0.5{Enter}");
        expect(valueOf().allowed).toEqual(["fd00:1::/64", "10.0.0.5/32"]);
        expect(within(screen.getByRole("list", { name: "Allowed ranges" })).getAllByRole("listitem")).toHaveLength(2);
    });

    it("refuses a range the list holds already and removes one by its button", async () => {
        const user = userEvent.setup();
        render(<Pane initial={{ blocks: true, allowed: ["10.10.10.0/24", "fd00:1::/64"] }} />);

        await user.type(screen.getByRole("textbox", { name: "Range to allow" }), "10.10.10.0/24");
        expect(screen.getByText("10.10.10.0/24 is in the list already.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

        await user.click(screen.getByRole("button", { name: "Remove 10.10.10.0/24" }));
        expect(valueOf().allowed).toEqual(["fd00:1::/64"]);
    });

    it("shows the ranges read only to someone who may not change the tenant", () => {
        render(<Pane initial={{ blocks: true, allowed: ["10.10.10.0/24"] }} disabled />);

        expect(screen.getByRole("switch", { name: "Block the local network" })).toBeDisabled();
        expect(screen.getByText("10.10.10.0/24")).toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    });

    it("saves the network with Save changes of the Edit dialog, after What it may add", async () => {
        const user = userEvent.setup();
        setTenantNetwork.mockResolvedValue({ success: true });
        const onClose = vi.fn();
        render(<TenantEditDialog tenant={ACME} section="network" viewerId="u1" canManage viewerPlatformAdmin onClose={onClose} onChanged={vi.fn()} />);

        const dialog = screen.getByRole("dialog", { name: "Edit Acme" });
        const tabs = within(dialog).getAllByRole("tab").map((tab) => tab.textContent);
        expect(tabs.indexOf("Network")).toBe(tabs.indexOf("What it may add") + 1);

        await user.click(within(dialog).getByRole("switch", { name: "Block the local network" }));
        await user.type(within(dialog).getByRole("textbox", { name: "Range to allow" }), "10.10.10.0/24{Enter}");
        expect(within(dialog).getByText("Changed: the network")).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(setTenantNetwork).toHaveBeenCalledWith("t-acme", { blocks: true, allowed: ["10.10.10.0/24"] }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe("the network of a tenant in its row", () => {
    it("marks a tenant that reaches the local network, and names the ranges a blocked one reaches anyway", () => {
        const { rerender } = render(<NetworkCell row={{ isHome: false, network: { blocks: false, allowed: [] } }} />);
        expect(screen.getByText("Reaches it")).toHaveAttribute("title", "Its connections reach the local network of the server DBackup runs on.");

        rerender(<NetworkCell row={{ isHome: false, network: { blocks: true, allowed: ["10.0.0.0/8", "fd00::/8"] } }} />);
        expect(screen.getByText("Blocked")).toBeInTheDocument();
        expect(screen.getByText("2 ranges allowed")).toBeInTheDocument();

        rerender(<NetworkCell row={{ isHome: true, network: { blocks: false, allowed: [] } }} />);
        expect(screen.getByText("Platform")).toBeInTheDocument();
    });

    it("says nothing about an empty field and why a full list takes no more", () => {
        expect(rangeDraft("  ", [])).toEqual({ range: null, problem: null });
        expect(rangeDraft("10.0.0.0/8", Array.from({ length: 50 }, (_, index) => `10.${index}.0.0/16`)).problem).toBe("A tenant has at most 50 allowed ranges. Allow a wider range instead.");
    });
});
