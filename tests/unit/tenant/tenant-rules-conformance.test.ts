import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { TenantScopeError } from "@/lib/logging/errors";
import {
    ALL_TENANTS_PERMISSIONS,
    HOME_KEY_PLATFORM_PERMISSIONS,
    PLATFORM_ADMIN_ROLE,
    PLATFORM_PERMISSIONS,
    PROFILE_PERMISSIONS,
    allTenantsPermissionsOf,
    capToOwner,
    ownerPermissionsIn,
} from "@/lib/auth/owner-permissions";
import { AVAILABLE_PERMISSIONS, PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } from "@/lib/auth/permissions";
import { CHILD_MODELS, TENANT_MODELS, allTenantsArgs } from "@/lib/tenant/prisma-scope";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * The rules of the tenants that hold for every case rather than for the examples of one feature:
 * All tenants changes nothing of a tenant, and an API key never carries more of the platform than
 * its tenant and its owner allow.
 */

const PLATFORM_ONLY = PLATFORM_ONLY_PERMISSIONS.map((permission) => permission.id as string);
const SHARING: string[] = [PERMISSIONS.PLATFORM.SHARING_READ, PERMISSIONS.PLATFORM.SHARING_WRITE];
const EVERY_TENANT_RIGHT = AVAILABLE_PERMISSIONS.map((permission) => permission.id as string);

/** The owners a key can have, from the platform admin down to the admin of one customer. */
const OWNERS = {
    platformAdmin: { platformRole: PLATFORM_ADMIN_ROLE, memberships: [] },
    platformGroupOfAll: {
        platformRole: null,
        memberships: [],
        platformGroup: { platformPermissions: JSON.stringify([...PLATFORM_ONLY, PERMISSIONS.SETTINGS.WRITE]), tenantPermissions: JSON.stringify(EVERY_TENANT_RIGHT), allTenants: true, tenants: [] },
    },
    platformGroupOfAcme: {
        platformRole: null,
        memberships: [],
        platformGroup: { platformPermissions: JSON.stringify(PLATFORM_ONLY), tenantPermissions: JSON.stringify(EVERY_TENANT_RIGHT), allTenants: false, tenants: [{ tenantId: "acme" }] },
    },
    fullAccessEverywhere: {
        platformRole: null,
        memberships: [HOME_TENANT_ID, "acme", "globex"].map((tenantId) => ({ tenantId, group: { permissions: "[]", fullAccess: true } })),
    },
    customerAdmin: { platformRole: null, memberships: [{ tenantId: "acme", group: { permissions: "[]", fullAccess: true } }] },
} as const;

describe("an API key of a customer tenant", () => {
    for (const [name, owner] of Object.entries(OWNERS)) {
        it(`carries no right of the platform, of ${name}, in a tenant that shares nothing`, () => {
            expect(ownerPermissionsIn(owner, "acme", false).filter((permission) => PLATFORM_ONLY.includes(permission))).toEqual([]);
        });

        it(`carries the sharing at most, of ${name}, in a tenant that shares with customers`, () => {
            const platform = ownerPermissionsIn(owner, "acme", true).filter((permission) => PLATFORM_ONLY.includes(permission));
            expect(platform.every((permission) => SHARING.includes(permission))).toBe(true);
        });

        it(`carries no setting of the instance, of ${name}`, () => {
            for (const shares of [false, true]) {
                expect(ownerPermissionsIn(owner, "acme", shares).filter((permission) => PLATFORM_PERMISSIONS.has(permission))).toEqual([]);
            }
        });
    }
});

describe("an API key of the home tenant", () => {
    for (const [name, owner] of Object.entries(OWNERS)) {
        it(`carries the tenants, the accounts and the sharing at most, and never the sign-in, of ${name}`, () => {
            const keyable = new Set<string>([...HOME_KEY_PLATFORM_PERMISSIONS, ...SHARING]);
            const platform = ownerPermissionsIn(owner, HOME_TENANT_ID, true).filter((permission) => PLATFORM_ONLY.includes(permission));
            expect(platform.filter((permission) => !keyable.has(permission))).toEqual([]);
            expect(platform).not.toContain(PERMISSIONS.PLATFORM.SIGN_IN_READ);
            expect(platform).not.toContain(PERMISSIONS.PLATFORM.SIGN_IN_WRITE);
        });
    }

    it("never carries a right of the platform its owner's platform group does not give", () => {
        const readsOnly = {
            platformRole: null,
            memberships: [],
            platformGroup: { platformPermissions: JSON.stringify([PERMISSIONS.PLATFORM.TENANTS_READ]), tenantPermissions: "[]", allTenants: true, tenants: [] },
        };
        const platform = ownerPermissionsIn(readsOnly, HOME_TENANT_ID, true).filter((permission) => PLATFORM_ONLY.includes(permission));
        expect(platform).toEqual([PERMISSIONS.PLATFORM.TENANTS_READ]);
    });

    it("loses a right at the next request once its owner lost it", () => {
        const stored = [PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.JOBS.READ];
        const before = ownerPermissionsIn(OWNERS.platformGroupOfAll, HOME_TENANT_ID, false);
        expect(capToOwner(stored, before)).toEqual(stored);
        const after = ownerPermissionsIn({ ...OWNERS.platformGroupOfAll, platformGroup: null }, HOME_TENANT_ID, false);
        expect(capToOwner(stored, after)).toEqual([]);
    });
});

describe("the rows that hang off a row of a tenant", () => {
    /**
     * Models that point at a row of a tenant but are read by the platform through services that name
     * the tenant themselves, see tenant-isolation.test.ts. Anything else that points at a row of a
     * tenant belongs to that tenant and is filtered, or a new model reads every tenant unnoticed.
     */
    const PLATFORM_READ = new Set(["TenantMembership", "TenantInvitation"]);

    it("are each in TENANT_MODELS or CHILD_MODELS", () => {
        const owned = new Set([...TENANT_MODELS, ...Object.keys(CHILD_MODELS)]);
        const loose = Prisma.dmmf.datamodel.models
            .filter((model) => !owned.has(model.name) && !PLATFORM_READ.has(model.name))
            .filter((model) => model.fields.some((field) => field.kind === "object" && (field.relationFromFields?.length ?? 0) > 0 && owned.has(field.type)))
            .map((model) => model.name);
        expect(loose, "Add the model to CHILD_MODELS with the relation to its parent, or to TENANT_MODELS").toEqual([]);
    });
});

describe("All tenants", () => {
    it("holds no right that changes the data of a tenant", () => {
        const tenantWrites = EVERY_TENANT_RIGHT.filter((permission) =>
            !permission.endsWith(":read")
            && !permission.endsWith(":view")
            && !PLATFORM_PERMISSIONS.has(permission)
            && !PROFILE_PERMISSIONS.has(permission)
            && permission !== PERMISSIONS.USERS.WRITE);
        expect(tenantWrites.length).toBeGreaterThan(0);
        expect(ALL_TENANTS_PERMISSIONS.filter((permission) => tenantWrites.includes(permission))).toEqual([]);
        expect(allTenantsPermissionsOf([], OWNERS.platformGroupOfAll.platformGroup).filter((permission) => tenantWrites.includes(permission))).toEqual([]);
    });

    const CACHES = new Set(["StorageListCache", "DatabaseListCache", "HealthCheckLog", "DbVersionHistory"]);
    const WRITES = ["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"];
    for (const model of [...TENANT_MODELS, ...Object.keys(CHILD_MODELS)].filter((name) => !CACHES.has(name))) {
        it(`refuses every write of ${model}`, () => {
            for (const operation of WRITES) {
                expect(() => allTenantsArgs(model, operation, { where: {}, data: {} }), `${model}.${operation}`).toThrow(TenantScopeError);
            }
            expect(() => allTenantsArgs(model, "findMany", {})).not.toThrow();
        });
    }
});
