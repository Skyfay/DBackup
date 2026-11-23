import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/auth/table-preferences", () => ({ saveViewLayout: vi.fn() }));
vi.mock("@/components/dashboard/sign-in/sign-in-tab", () => ({ SignInTab: () => null }));
vi.mock("@/components/dashboard/users/users-tab", () => ({ UsersTab: () => null }));
vi.mock("@/components/dashboard/platform/platform-group-list", () => ({ PlatformGroupList: () => null }));
vi.mock("@/components/dashboard/platform/tenant-groups-list", () => ({ TenantGroupsList: () => null }));

const { platformTabOf } = await import("@/components/dashboard/platform/platform-users-client");

describe("the tab of Users & Groups of the Platform a link opens", () => {
    it("opens the platform groups and the tenant groups as tabs of their own", () => {
        expect(platformTabOf("groups")).toBe("groups");
        expect(platformTabOf("tenant-groups")).toBe("tenant-groups");
    });

    it("keeps the links of the former switch on the groups and of the providers working", () => {
        expect(platformTabOf("groups", "tenant")).toBe("tenant-groups");
        expect(platformTabOf("groups", "platform")).toBe("groups");
        expect(platformTabOf("sso")).toBe("providers");
    });

    it("opens Users for a tab it does not know", () => {
        expect(platformTabOf(null)).toBe("users");
        expect(platformTabOf("nothing")).toBe("users");
    });
});
