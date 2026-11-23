/**
 * The tenants of an account on the list of every account, for someone of a platform group of some
 * tenants. They change who works in a tenant only where their platform group reaches it, and only
 * with the groups that may do no more than they may there, like `setTenantMember` checks.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserTenantsSection } from "@/components/dashboard/users/user-tenants-section";
import { TenantRolesField } from "@/components/dashboard/users/user-tenant-roles-field";
import { givableIn, managesTenant, newUserChoices } from "@/components/dashboard/users/user-access";
import { TenantViewProvider } from "@/components/tenant/tenant-view";
import type { UserRow, UsersGroup } from "@/services/user/users-types";

vi.mock("@/app/actions/tenant/members", () => ({ setTenantMember: vi.fn() }));
vi.mock("@/app/actions/tenant/tenant", () => ({ switchTenant: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TENANTS = [
    { id: "default", name: "Skyfay" },
    { id: "acme", name: "Acme GmbH" },
    { id: "globex", name: "Globex" },
    { id: "initech", name: "Initech" },
];

const GROUPS: UsersGroup[] = [
    { id: "acme-admin", tenantId: "acme", name: "Admin", members: 1, permissions: [], superAdmin: true },
    { id: "acme-ops", tenantId: "acme", name: "Operators", members: 1, permissions: [], superAdmin: false },
    { id: "globex-ops", tenantId: "globex", name: "Operators", members: 1, permissions: [], superAdmin: false },
    { id: "initech-ops", tenantId: "initech", name: "Operators", members: 0, permissions: [], superAdmin: false },
];

/** Nina's platform group reaches Acme and Initech, where she may give Operators but not Admin. */
const REACH = { managedTenants: ["acme", "initech"], givableGroups: ["acme-ops", "initech-ops"] };

const TOM: UserRow = {
    id: "tom",
    name: "Tom Tech",
    email: "tom@example.ch",
    image: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    group: null,
    tenants: [
        { tenantId: "acme", group: { id: "acme-ops", name: "Operators" } },
        { tenantId: "globex", group: { id: "globex-ops", name: "Operators" } },
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

function show(user: UserRow) {
    render(
        <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: false }}>
            <UserTenantsSection user={user} groups={GROUPS} canManage managedTenants={REACH.managedTenants} givableGroups={REACH.givableGroups} onChanged={vi.fn()} />
        </TenantViewProvider>
    );
}

describe("the tenants of an account for a platform group of some tenants", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("offers the groups of a tenant only where the platform group reaches, and only those within the viewer's rights", () => {
        expect(managesTenant(REACH, "acme")).toBe(true);
        expect(managesTenant(REACH, "globex")).toBe(false);
        expect(givableIn(GROUPS, "acme", REACH).map((group) => group.id)).toEqual(["acme-ops"]);
        expect(givableIn(GROUPS, "globex", REACH)).toEqual([]);
        expect(givableIn(GROUPS, "globex", { managedTenants: null, givableGroups: null }).map((group) => group.id)).toEqual(["globex-ops"]);
    });

    it("changes the tenant the platform group reaches and leaves the other one as it is", () => {
        show(TOM);

        expect(screen.getByRole("combobox", { name: "Group in Acme GmbH" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Remove from Acme GmbH" })).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Group in Globex" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Remove from Globex" })).not.toBeInTheDocument();
    });

    it("leaves a group the viewer may not give as it is, also in a tenant they reach", () => {
        show({ ...TOM, tenants: [{ tenantId: "acme", group: { id: "acme-admin", name: "Admin" } }] });

        expect(screen.queryByRole("combobox", { name: "Group in Acme GmbH" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Remove from Acme GmbH" })).not.toBeInTheDocument();
    });

    it("adds the account only to a tenant the platform group reaches", async () => {
        show(TOM);

        await userEvent.click(screen.getByRole("button", { name: "Add to a tenant" }));
        await userEvent.click(screen.getByRole("combobox", { name: "The tenant" }));
        const options = (await screen.findAllByRole("option")).map((option) => option.textContent ?? "");
        expect(options.some((text) => text.includes("Initech"))).toBe(true);
        expect(options.some((text) => text.includes("Skyfay") || text.includes("Globex"))).toBe(false);
    });
});

describe("the tenants of an account in Edit user for a platform group of some tenants", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("changes and removes only where the platform group reaches, the other tenant stays as it is", () => {
        const before = TOM.tenants ?? [];
        render(
            <TenantViewProvider value={{ tenants: TENANTS, activeTenantId: null, allTenants: true, isPlatformAdmin: false }}>
                <TenantRolesField before={before} value={before.map((role) => ({ tenantId: role.tenantId, groupId: role.group.id }))} onChange={vi.fn()} groups={GROUPS} lock={null} reach={REACH} />
            </TenantViewProvider>
        );

        expect(screen.getByRole("button", { name: "Remove from Acme GmbH" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Remove from Globex" })).toBeDisabled();
        expect(screen.getByRole("combobox", { name: "Group in Globex" })).toBeDisabled();
    });
});

describe("New user on the list of every account", () => {
    it("offers only the tenants where the viewer adds people, each with the groups they may give there", () => {
        // Nina adds people to Acme and Initech, and of their groups gives Operators alone.
        const choices = newUserChoices(TENANTS, GROUPS, { managedTenants: ["acme", "initech"], givableGroups: ["acme-ops", "initech-ops"] });

        expect(choices.tenants.map((tenant) => tenant.id)).toEqual(["acme", "initech"]);
        expect(choices.groups.map((group) => group.id)).toEqual(["acme-ops", "initech-ops"]);
    });

    it("leaves out a tenant where the viewer may give no group, but keeps the home tenant, where an account starts without one", () => {
        const choices = newUserChoices(TENANTS, GROUPS, { managedTenants: ["default", "acme", "globex"], givableGroups: ["acme-ops"] });

        expect(choices.tenants.map((tenant) => tenant.id)).toEqual(["default", "acme"]);
        expect(choices.groups.map((group) => group.id)).toEqual(["acme-ops"]);
    });

    it("offers every tenant and every group to a platform admin", () => {
        const choices = newUserChoices(TENANTS, GROUPS, { managedTenants: null, givableGroups: null });

        expect(choices.tenants).toEqual(TENANTS);
        expect(choices.groups).toEqual(GROUPS);
    });
});
