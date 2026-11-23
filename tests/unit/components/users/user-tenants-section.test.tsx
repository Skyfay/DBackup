import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserTenantsSection } from "@/components/dashboard/users/user-tenants-section";
import { TenantViewProvider } from "@/components/tenant/tenant-view";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { UserRow, UsersGroup } from "@/services/user/users-types";

const mocks = vi.hoisted(() => ({ setTenantMember: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock("@/app/actions/tenant/members", () => ({ setTenantMember: (...args: unknown[]) => mocks.setTenantMember(...args) }));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => mocks.success(...args), error: (...args: unknown[]) => mocks.error(...args) } }));

const TENANTS = [
    { id: "default", name: "Skyfay" },
    { id: "acme", name: "Acme GmbH" },
    { id: "globex", name: "Globex" },
];

const GROUPS: UsersGroup[] = [
    { id: "admin", name: "Admin", members: 1, permissions: [], superAdmin: true },
    { id: "operators", name: "Operators", members: 2, permissions: [PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE], superAdmin: false },
];

const TOM: UserRow = {
    id: "tom",
    name: "Tom Tech",
    email: "tom@example.ch",
    image: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    group: null,
    tenants: [
        { tenantId: "acme", group: { id: "operators", name: "Operators" } },
        { tenantId: "default", group: { id: "admin", name: "Admin" } },
    ],
    superAdmin: false,
    elsewhere: true,
    methods: [{ kind: "password" }],
    secondFactor: "none",
    lastSignIn: null,
    sessions: 0,
    apiKeys: 0,
    isYou: false,
};

function show(user: UserRow, canManage = true) {
    const onChanged = vi.fn();
    render(
        <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: true }}>
            <UserTenantsSection user={user} groups={GROUPS} canManage={canManage} onChanged={onChanged} />
        </TenantViewProvider>
    );
    return { actor: userEvent.setup(), onChanged };
}

describe("the tenants of an account in its panel in All tenants", () => {
    beforeAll(() => {
        // cmdk scrolls the highlighted row into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setTenantMember.mockResolvedValue({ success: true });
    });

    it("lists each tenant by name, the home tenant first, with the group there", () => {
        show(TOM);

        const rows = screen.getAllByRole("listitem");
        expect(rows.map((row) => within(row).getByText(/^(Skyfay|Acme GmbH)$/).textContent)).toEqual(["Skyfay", "Acme GmbH"]);
        expect(screen.getByRole("combobox", { name: "Group in Acme GmbH" })).toHaveTextContent("Operators");
        expect(screen.getByRole("combobox", { name: "Group in Skyfay" })).toHaveTextContent("Admin");
    });

    it("removes the account from one tenant after asking, through the tenant it names", async () => {
        const { actor, onChanged } = show(TOM);

        await actor.click(screen.getByRole("button", { name: "Remove from Acme GmbH" }));
        await actor.click(screen.getByRole("button", { name: "Remove from Acme GmbH" }));

        expect(mocks.setTenantMember).toHaveBeenCalledWith("acme", "tom", null);
        expect(onChanged).toHaveBeenCalled();
    });

    it("says why a change was refused, like the last one who manages the members of a tenant", async () => {
        mocks.setTenantMember.mockResolvedValue({ success: false, error: "Nobody else manages the members of this tenant. Give someone that right first." });
        const { actor, onChanged } = show(TOM);

        await actor.click(screen.getByRole("combobox", { name: "Group in Acme GmbH" }));
        await actor.click(screen.getByRole("option", { name: /Admin/ }));

        expect(mocks.setTenantMember).toHaveBeenCalledWith("acme", "tom", "admin");
        expect(mocks.error).toHaveBeenCalledWith("Nobody else manages the members of this tenant. Give someone that right first.");
        expect(onChanged).not.toHaveBeenCalled();
    });

    it("adds the account to a tenant it does not work in yet, with the group picked", async () => {
        const { actor } = show(TOM);

        await actor.click(screen.getByRole("button", { name: "Add to a tenant" }));
        await actor.click(screen.getByRole("combobox", { name: "The tenant" }));
        // Only the tenants it is in no member of yet.
        expect(screen.queryByRole("option", { name: /Acme GmbH/ })).not.toBeInTheDocument();
        await actor.click(screen.getByRole("option", { name: /Globex/ }));
        await actor.click(screen.getByRole("combobox", { name: "The group in the tenant" }));
        await actor.click(screen.getByRole("option", { name: /Operators/ }));
        await actor.click(screen.getByRole("button", { name: "Add" }));

        expect(mocks.setTenantMember).toHaveBeenCalledWith("globex", "tom", "operators");
    });

    it("warns about an account of no tenant, which signs in and sees nothing", () => {
        show({ ...TOM, tenants: [], elsewhere: false });

        expect(screen.getByText("In no tenant")).toBeInTheDocument();
    });

    it("offers no change to a viewer who may not make one", () => {
        show(TOM, false);

        expect(screen.queryByRole("button", { name: /Remove from/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add to a tenant" })).not.toBeInTheDocument();
        expect(screen.getByText("Operators")).toBeInTheDocument();
    });
});
