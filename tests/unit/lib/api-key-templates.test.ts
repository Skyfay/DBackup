import { describe, expect, it } from "vitest";
import { API_KEY_TEMPLATES, exampleTaskFor, templateExample } from "@/lib/auth/api-key-templates";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { capToOwner, groupPermissions, permissionsIn } from "@/lib/auth/owner-permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const KNOWN = new Set<string>(AVAILABLE_PERMISSIONS.map((permission) => permission.id));

describe("the tasks of New API key", () => {
    it("hold only permissions that exist, and nothing that changes a thing", () => {
        for (const template of API_KEY_TEMPLATES) {
            expect(template.permissions.every((permission) => KNOWN.has(permission)), template.id).toBe(true);
            expect(template.permissions.some((permission) => permission.endsWith(":write") || permission.endsWith(":delete")), template.id).toBe(false);
        }
    });

    it("give the CI task exactly what the API trigger of a job needs", () => {
        expect(API_KEY_TEMPLATES.find((template) => template.id === "ci")?.permissions).toEqual(["jobs:execute", "history:read"]);
    });

    it("show a new key in its first request and never in the panel", () => {
        const withKey = templateExample("ci", "https://backup.example.ch", "dbackup_abc");
        const withoutKey = templateExample("ci", "https://backup.example.ch", null);

        expect(withKey.code.split("\n")[0]).toBe("KEY=dbackup_abc");
        expect(withKey.code).toContain('-H "Authorization: Bearer $KEY"');
        expect(withoutKey.code).not.toContain("dbackup_");
        expect(withoutKey.code).toContain('-H "Authorization: Bearer $DBACKUP_KEY"');
    });

    it("pick an example a key without a task can run", () => {
        expect(exampleTaskFor(["jobs:read", "history:read"])).toBe("monitoring");
        expect(exampleTaskFor(["dashboard:read"])).toBe("widget");
        expect(exampleTaskFor(["users:read"])).toBeNull();
        expect(templateExample(null, "", "k").name).toBe("List the jobs");
    });
});

describe("the most a key may do", () => {
    const operators = { permissions: JSON.stringify(["jobs:execute", "history:read"]), fullAccess: false };
    const fullAccess = { permissions: "[]", fullAccess: true };

    it("is what the group of its owner may do", () => {
        expect(capToOwner(["jobs:execute", "users:write"], groupPermissions(operators))).toEqual(["jobs:execute"]);
        expect(groupPermissions(operators)).toEqual(["jobs:execute", "history:read"]);
    });

    it("is everything for the full access group and nothing without a group", () => {
        expect(groupPermissions(fullAccess)).toHaveLength(AVAILABLE_PERMISSIONS.length);
        expect(capToOwner(["jobs:read"], groupPermissions(null))).toEqual([]);
    });

    it("drops what no longer exists", () => {
        expect(capToOwner(["storage:write", "jobs:read"], groupPermissions(fullAccess))).toEqual(["jobs:read"]);
    });

    it("is what the group of its owner may do in the tenant of the key, never in another", () => {
        const memberships = [
            { tenantId: HOME_TENANT_ID, group: { permissions: JSON.stringify(["history:read", "settings:read"]), fullAccess: false } },
            { tenantId: "tenant-a", group: operators },
        ];

        expect(capToOwner(["jobs:execute", "history:read"], permissionsIn(memberships, "tenant-a"))).toEqual(["jobs:execute", "history:read"]);
        expect(capToOwner(["jobs:execute", "history:read"], permissionsIn(memberships, HOME_TENANT_ID))).toEqual(["history:read"]);
        expect(capToOwner(["jobs:execute"], permissionsIn(memberships, "tenant-b"))).toEqual([]);
    });

    it("reaches the settings of the instance only through the group in the home tenant", () => {
        const customerAdmin = [{ tenantId: "tenant-a", group: fullAccess }];

        // The groups of the tenant are its own, so a key of its admin may manage them.
        expect(capToOwner(["settings:write", "groups:write", "jobs:write"], permissionsIn(customerAdmin, "tenant-a"))).toEqual(["groups:write", "jobs:write"]);
    });
});
