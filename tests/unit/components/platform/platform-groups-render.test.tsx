import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformGroupList } from "@/components/dashboard/platform/platform-group-list";
import { UserPlatformGroupSection } from "@/components/dashboard/platform/user-platform-group";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformGroupRow, PlatformGroupsModel } from "@/services/user/platform-groups-types";
import type { UserRow } from "@/services/user/users-types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), setFor: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/auth/platform-group", () => ({
    createPlatformGroup: (...args: unknown[]) => mocks.create(...args),
    updatePlatformGroup: (...args: unknown[]) => mocks.update(...args),
    deletePlatformGroup: (...args: unknown[]) => mocks.remove(...args),
    setUserPlatformGroup: (...args: unknown[]) => mocks.setFor(...args),
}));
vi.mock("@/app/actions/tenant/members", () => ({ setPlatformAdmin: vi.fn() }));

// cmdk scrolls the highlighted entry into view, which jsdom does not draw.
Element.prototype.scrollIntoView = vi.fn();

const P = PERMISSIONS;
const member = (id: string, name: string) => ({ id, name, email: `${id}@example.com`, image: null, isYou: false });

const group = (over: Partial<PlatformGroupRow>): PlatformGroupRow => ({
    id: "pg-support",
    name: "Support",
    builtIn: false,
    platformPermissions: [P.PLATFORM.TENANTS_READ],
    tenantPermissions: [P.JOBS.READ, P.JOBS.EXECUTE, P.STORAGE.READ, P.STORAGE.RESTORE, P.HISTORY.READ],
    allTenants: true,
    tenantIds: [],
    members: [member("lena", "Lena Graf")],
    createdAt: "2026-10-02T09:00:00.000Z",
    made: { at: "2026-10-02T09:00:00.000Z", by: "Manu" },
    changed: null,
    ...over,
});

const MODEL: PlatformGroupsModel = {
    groups: [
        group({ id: "platform-admin", name: "Platform admin", builtIn: true, platformPermissions: [P.PLATFORM.TENANTS_WRITE], members: [member("root", "Manu")], made: null }),
        group({}),
        group({ id: "pg-tech", name: "Technicians", allTenants: false, tenantIds: ["acme", "shop"], platformPermissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.SHARING_READ, P.PLATFORM.SHARING_WRITE] }),
    ],
    tenants: [
        { id: "default", name: "Skyfay Hosting", isHome: true, jobs: 6, databases: 9 },
        { id: "acme", name: "Acme GmbH", isHome: false, jobs: 4, databases: 7 },
        { id: "shop", name: "Shop", isHome: false, jobs: 1, databases: 1 },
    ],
    accounts: 23,
    viewer: { platformAdmin: true, permissions: [], group: null, groupId: null },
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: MODEL }), { status: 200 })));
});

describe("the platform groups under Platform, Users & Groups", () => {
    it("lists Platform admin built in first, then each group with its rights and where they count", async () => {
        render(<PlatformGroupList cards={false} canManage toolbarStart={null} />);

        const admin = await screen.findByRole("row", { name: /Platform admin/ });
        expect(within(admin).getByText("Built in")).toBeInTheDocument();
        expect(within(admin).getByText("Everything on the platform")).toBeInTheDocument();
        const support = screen.getByRole("row", { name: /Support/ });
        expect(within(support).getByText("Sees the tenants")).toBeInTheDocument();
        expect(within(support).getByText("3 today, new ones too")).toBeInTheDocument();
        const technicians = screen.getByRole("row", { name: /Technicians/ });
        expect(within(technicians).getByText("2 tenants")).toBeInTheDocument();
        expect(within(technicians).getByText("Sees the tenants, shares with customers")).toBeInTheDocument();
    });

    it("opens Platform admin read only, with Duplicate as a new group", async () => {
        render(<PlatformGroupList cards={false} canManage toolbarStart={null} />);

        await userEvent.click(await screen.findByRole("button", { name: "Platform admin" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Built in, read only")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: /Duplicate as a new group/ })).toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    });

    it("edits a group in three parts and names what changed in the foot", async () => {
        mocks.update.mockResolvedValue({ success: true });
        render(<PlatformGroupList cards={false} canManage toolbarStart={null} />);

        await userEvent.click(await screen.findByRole("button", { name: "Support" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Edit Support")).toBeInTheDocument();
        await userEvent.click(within(dialog).getAllByRole("button", { name: /Where/ })[0]);
        await userEvent.click(within(dialog).getByRole("radio", { name: /Selected tenants/ }));
        await userEvent.click(within(dialog).getByRole("checkbox", { name: /Acme GmbH/ }));
        expect(within(dialog).getByText("Changed: Where")).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
        expect(mocks.update).toHaveBeenCalledWith("pg-support", expect.objectContaining({ allTenants: false, tenantIds: ["acme"] }));
    });
});

describe("New platform group", () => {
    it("starts with Custom or a copy, then makes the group with the rights and the tenants picked", async () => {
        mocks.create.mockResolvedValue({ success: true, data: { id: "pg-new" } });
        const ref = { current: null as null | { openCreate: () => void } };
        render(<PlatformGroupList ref={ref} cards={false} canManage toolbarStart={null} />);
        await screen.findByRole("row", { name: /Support/ });

        act(() => ref.current?.openCreate());
        const start = await screen.findByRole("dialog");
        expect(within(start).getByText("Step 1 of 2")).toBeInTheDocument();
        await userEvent.click(within(start).getByRole("button", { name: /Custom/ }));

        const dialog = await screen.findByRole("dialog");
        await userEvent.type(within(dialog).getByLabelText("Name"), "Database team");
        await userEvent.click(within(dialog).getByRole("radio", { name: "See" }));
        expect(within(dialog).getByText("1 area on the platform · 0 areas in every tenant", { exact: false })).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: /Create group/ }));

        expect(mocks.create).toHaveBeenCalledWith({ name: "Database team", platformPermissions: [PERMISSIONS.PLATFORM.TENANTS_READ], tenantPermissions: [], allTenants: true, tenantIds: [] });
    });
});

describe("the platform group in the panel of an account", () => {
    const LENA: UserRow = {
        id: "lena",
        name: "Lena Graf",
        email: "lena@example.com",
        image: null,
        createdAt: "2026-06-01T09:00:00.000Z",
        group: null,
        tenants: [],
        platformGroup: { id: "pg-support", name: "Support" },
        superAdmin: false,
        elsewhere: false,
        methods: [{ kind: "password" }],
        secondFactor: "none",
        lastSignIn: null,
        sessions: 0,
        apiKeys: 0,
        isYou: false,
    };

    it("picks No platform group first, Platform admin and the other groups, and gives one at once", async () => {
        mocks.setFor.mockResolvedValue({ success: true, data: { from: "Support", to: "Technicians" } });
        render(<UserPlatformGroupSection user={LENA} canManage onChanged={vi.fn()} />);

        await userEvent.click(await screen.findByRole("combobox", { name: "Platform group" }));
        const options = await screen.findAllByRole("option");
        expect(options.map((option) => option.textContent?.split(/[A-Z][a-z]+ the|Everything|Only/)[0])).toEqual(["No platform group", "Platform admin", "Support", "Technicians"]);

        await userEvent.click(screen.getByRole("option", { name: /Technicians/ }));
        expect(mocks.setFor).toHaveBeenCalledWith("lena", { kind: "group", id: "pg-tech" });
    });

    it("asks before it makes someone a platform admin", async () => {
        render(<UserPlatformGroupSection user={LENA} canManage onChanged={vi.fn()} />);

        await userEvent.click(await screen.findByRole("combobox", { name: "Platform group" }));
        await userEvent.click(await screen.findByRole("option", { name: /Platform admin/ }));

        expect(await screen.findByRole("alertdialog", { name: /Make Lena Graf a platform admin/ })).toBeInTheDocument();
        expect(mocks.setFor).not.toHaveBeenCalled();
    });
});
