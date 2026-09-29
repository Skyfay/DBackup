import { describe, expect, it } from "vitest";
import { API_KEY_TEMPLATES, exampleTaskFor, templateExample } from "@/lib/auth/api-key-templates";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { capToOwner, groupPermissions } from "@/lib/auth/owner-permissions";

const KNOWN = new Set(AVAILABLE_PERMISSIONS.map((permission) => permission.id));

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
    it("is what the group of its owner may do", () => {
        const operators = { name: "Operators", permissions: JSON.stringify(["jobs:execute", "history:read"]) };

        expect(capToOwner(["jobs:execute", "users:write"], operators)).toEqual(["jobs:execute"]);
        expect(groupPermissions(operators)).toEqual(["jobs:execute", "history:read"]);
    });

    it("is everything for a SuperAdmin and nothing without a group", () => {
        expect(groupPermissions({ name: "SuperAdmin", permissions: "[]" })).toHaveLength(AVAILABLE_PERMISSIONS.length);
        expect(capToOwner(["jobs:read"], null)).toEqual([]);
    });

    it("drops what no longer exists", () => {
        expect(capToOwner(["storage:write", "jobs:read"], { name: "SuperAdmin", permissions: "[]" })).toEqual(["jobs:read"]);
    });
});
