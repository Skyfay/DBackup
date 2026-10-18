// @vitest-environment node
/**
 * Whose log keeps a change of the own account. Nina of the platform works in the tenant of Acme
 * through her platform group, without being a member there. Acme must never read that she changed
 * her password, her email from what to what, her picture or her sign-in providers. Anna is a member
 * of Acme, so her changes stay in its log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

interface TestViewer {
    id: string;
    name: string;
    email: string;
    image: string | null;
    timezone: string;
    dateFormat: string;
    timeFormat: string;
    isPlatformAdmin: boolean;
    tenantId: string | null;
    allTenants: boolean;
    permissions: string[];
}

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as TestViewer,
    /** The people of each tenant, as `membershipService.isPersonOf` reads them. */
    people: new Map<string, Set<string>>(),
    audit: vi.fn(),
    unlinkAccount: vi.fn(),
    getSession: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async () => mocks.viewer),
    getViewer: vi.fn(async () => mocks.viewer),
    getAuthContext: vi.fn(async () => ({ userId: mocks.viewer.id, tenantId: mocks.viewer.tenantId, allTenants: mocks.viewer.allTenants, authMethod: "session", isPlatformAdmin: false, permissions: [] })),
    hasPermission: vi.fn(async () => true),
    hasPermissionWithContext: vi.fn(() => true),
    currentSessionId: vi.fn(async () => "s-here"),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { unlinkAccount: mocks.unlinkAccount, getSession: mocks.getSession, signOut: vi.fn(async () => undefined) } } }));
vi.mock("@/lib/crypto", () => ({ decrypt: (token: string) => token }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/membership-service", () => ({
    membershipService: { isPersonOf: vi.fn(async (userId: string, tenantId: string) => mocks.people.get(tenantId)?.has(userId) ?? false) },
}));
vi.mock("@/services/user/user-service", () => ({
    userService: {
        hasPassword: vi.fn(async () => true),
        revokeSessions: vi.fn(async () => 1),
        updateUser: vi.fn(async () => ({})),
        ownEmailRefusal: vi.fn(async () => null),
    },
}));
vi.mock("@/services/user/group-service", () => ({ groupService: { find: vi.fn() } }));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { switchable: vi.fn(async () => []) } }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { verifyPassword: vi.fn(async () => true), setPassword: vi.fn(async () => undefined) } }));
vi.mock("@/services/user/preference-service", () => ({ getAutoRedirectOnJobStart: vi.fn(), setAutoRedirectOnJobStart: vi.fn(async () => undefined), setTaskColors: vi.fn() }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("@/services/sso/email-domain-claims", () => ({ claimedEmailRefusal: vi.fn(async () => null) }));
vi.mock("@/services/sso/sso-connections-service", () => ({ countSignInAccounts: vi.fn(async () => 2), listSsoConnections: vi.fn(), prepareSsoConnect: vi.fn() }));
vi.mock("@/services/user/avatar-service", () => ({
    AVATAR_MAX_BYTES: 5 * 1024 * 1024,
    saveAvatar: vi.fn(async () => "/api/avatar/x?v=1"),
    removeAvatar: vi.fn(async () => undefined),
}));

const { updateOwnPassword, updateUserPreferences } = await import("@/app/actions/auth/user");
const { saveProfileAccountAction, saveProfileDatesAction } = await import("@/app/actions/auth/profile");
const { unlinkMySsoAccount } = await import("@/app/actions/auth/sso-connections");
const avatarRoute = await import("@/app/api/user/avatar/route");
const linkCallback = await import("@/app/api/auth/sso-link-callback/route");

const person = (id: string, name: string): TestViewer => ({
    id,
    name,
    email: `${id}@example.ch`,
    image: "/api/avatar/x?v=0",
    timezone: "",
    dateFormat: "P",
    timeFormat: "p",
    isPlatformAdmin: false,
    tenantId: "acme",
    allTenants: false,
    permissions: [],
});
/** Of the platform, working in Acme without a membership there. */
const NINA = person("nina", "Nina");
/** A member of Acme. */
const ANNA = person("anna", "Anna");

const ACME_LOG = { tenantId: "acme" };
const PLATFORM_LOG = { tenantId: HOME_TENANT_ID };

/** Every change of the own account the profile offers, each writing one entry. */
const ownChanges: [string, () => Promise<unknown>][] = [
    ["the password", () => updateOwnPassword("old-secret", "Harbor-Lamp-42")],
    ["the name and email", () => saveProfileAccountAction({ name: "New Name", email: "new@example.ch" })],
    ["the dates", () => saveProfileDatesAction({ timezone: "Europe/Zurich", dateFormat: "dd.MM.yyyy", timeFormat: "HH:mm" })],
    ["the preferences", () => updateUserPreferences(mocks.viewer.id, { autoRedirectOnJobStart: false })],
    ["a new picture", () => {
        const body = new FormData();
        body.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "me.jpg", { type: "image/jpeg" }));
        return avatarRoute.POST(new NextRequest("http://localhost/api/user/avatar", { method: "POST", body }));
    }],
    ["the removed picture", () => avatarRoute.DELETE()],
    ["an unlinked sign-in provider", () => unlinkMySsoAccount("keycloak", "acc-1")],
    ["a connected sign-in provider", () => {
        mocks.getSession.mockResolvedValue({ user: { id: mocks.viewer.id } });
        const token = encodeURIComponent(JSON.stringify({ userId: mocks.viewer.id, expiresAt: Date.now() + 60_000 }));
        return linkCallback.GET(new NextRequest(`http://localhost/api/auth/sso-link-callback?t=${token}`));
    }],
];

describe("the log of a change of the own account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.people = new Map([["acme", new Set(["anna"])], [HOME_TENANT_ID, new Set(["nina"])]]);
    });

    it.each(ownChanges)("keeps %s of someone of the platform out of the customer's log", async (_name, change) => {
        mocks.viewer = NINA;

        await change();

        expect(mocks.audit).toHaveBeenCalledTimes(1);
        expect(mocks.audit.mock.calls[0][5]).toEqual(PLATFORM_LOG);
    });

    it.each(ownChanges)("writes %s of a member into the log of the tenant", async (_name, change) => {
        mocks.viewer = ANNA;

        await change();

        expect(mocks.audit).toHaveBeenCalledTimes(1);
        expect(mocks.audit.mock.calls[0][5]).toEqual(ACME_LOG);
    });

    it.each(ownChanges)("writes %s made from All tenants into the log of the platform", async (_name, change) => {
        mocks.viewer = { ...ANNA, tenantId: null, allTenants: true };

        await change();

        expect(mocks.audit).toHaveBeenCalledTimes(1);
        expect(mocks.audit.mock.calls[0][5]).toEqual(PLATFORM_LOG);
    });
});
