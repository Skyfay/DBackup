import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: vi.fn() }));

const { buildApiKeysModel } = await import("@/services/auth/api-keys-model");
const { formerNames } = await import("@/services/auth/api-key-details");
type Build = Parameters<typeof buildApiKeysModel>[0];

const NOW = Date.parse("2026-09-29T12:00:00Z");
const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

const HOME = "default";
const OPERATORS = { name: "Operators", permissions: JSON.stringify(["jobs:read", "jobs:execute", "history:read"]), fullAccess: false };
const FULL_ACCESS = { name: "Admin", permissions: "[]", fullAccess: true };
const lena = { id: "lena", name: "Lena Graf", email: "lena@example.ch", image: null, platformRole: null, memberships: [{ tenantId: HOME, group: OPERATORS }] };
const manu = { id: "manu", name: "Manu", email: "manu@example.ch", image: null, platformRole: null, memberships: [{ tenantId: HOME, group: FULL_ACCESS }] };

const key = (overrides: Partial<Build["keys"][number]>): Build["keys"][number] => ({
    id: "key",
    name: "Key",
    prefix: "dbackup_4f1a9c0e",
    permissions: JSON.stringify(["jobs:read"]),
    enabled: true,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: at("2026-06-12T09:00:00Z"),
    tenantId: HOME,
    user: lena,
    ...overrides,
});

const KEYS: Build["keys"] = [
    key({ id: "k-ci", name: "CI pipeline", permissions: JSON.stringify(["jobs:execute", "history:read"]), lastUsedAt: at("2026-09-29T11:58:00Z"), expiresAt: at("2027-03-01T00:00:00Z") }),
    key({ id: "k-widget", name: "Dashboard widget", permissions: JSON.stringify(["dashboard:read"]), user: manu, expiresAt: new Date(NOW + 5 * DAY) }),
    key({ id: "k-old", name: "Old Jenkins", permissions: JSON.stringify(["jobs:execute", "users:write"]), enabled: false }),
    key({ id: "k-gone", name: "Uptime", permissions: JSON.stringify(["history:read"]), expiresAt: at("2026-09-01T00:00:00Z"), lastUsedAt: at("2026-08-31T10:00:00Z") }),
];

function build(overrides: Partial<Build> = {}) {
    return buildApiKeysModel({
        keys: KEYS,
        runs: [{ tenantId: HOME, triggerLabel: "CI pipeline", startedAt: at("2026-09-29T11:58:00Z"), status: "Success", job: { name: "Shop nightly" } }],
        viewer: { id: "lena", superAdmin: false, permissions: ["jobs:read", "jobs:execute", "history:read"] },
        now: NOW,
        ...overrides,
    });
}

describe("the keys of every tenant in All tenants", () => {
    it("names the tenant of each key and takes its last run from that tenant alone, though two keys share a name", () => {
        const model = build({
            keys: [
                key({ id: "k-home", name: "CI pipeline", tenantId: HOME }),
                key({ id: "k-acme", name: "CI pipeline", tenantId: "tenant-a", user: { ...lena, memberships: [{ tenantId: "tenant-a", group: OPERATORS }] } }),
            ],
            runs: [
                { tenantId: "tenant-a", triggerLabel: "CI pipeline", startedAt: at("2026-09-29T11:00:00Z"), status: "Failed", job: { name: "Acme shop" } },
                { tenantId: HOME, triggerLabel: "CI pipeline", startedAt: at("2026-09-28T11:00:00Z"), status: "Success", job: { name: "Shop nightly" } },
            ],
        });
        const byId = new Map(model.keys.map((row) => [row.id, row]));

        expect(byId.get("k-home")?.tenantId).toBe(HOME);
        expect(byId.get("k-acme")?.tenantId).toBe("tenant-a");
        expect(byId.get("k-home")?.lastRun).toEqual({ job: "Shop nightly", at: "2026-09-28T11:00:00.000Z", status: "Success" });
        expect(byId.get("k-acme")?.lastRun).toEqual({ job: "Acme shop", at: "2026-09-29T11:00:00.000Z", status: "Failed" });
    });
});

describe("the keys of the API keys tab", () => {
    it("lists the keys by name with their owner and state", () => {
        const model = build();

        expect(model.keys.map((row) => [row.name, row.state, row.isMine])).toEqual([
            ["CI pipeline", "enabled", true],
            ["Dashboard widget", "enabled", false],
            ["Old Jenkins", "disabled", true],
            ["Uptime", "expired", true],
        ]);
    });

    it("pauses what a key holds beyond the group of its owner", () => {
        const old = build().keys.find((row) => row.id === "k-old");

        expect(old?.effective).toEqual(["jobs:execute"]);
        expect(old?.paused).toEqual(["users:write"]);
        expect(old?.ownerPermissions).toEqual(["jobs:read", "jobs:execute", "history:read"]);
    });

    it("gives a key of an owner with the full access group all it holds", () => {
        const widget = build().keys.find((row) => row.id === "k-widget");

        expect(widget?.effective).toEqual(["dashboard:read"]);
        expect(widget?.paused).toEqual([]);
        expect(widget?.owner.groupName).toBe("Admin");
    });

    it("counts the group of the owner in the tenant of the key, and pauses all of a key whose owner left it", () => {
        // Lena runs jobs for the customer, but in the home tenant she has no group anymore.
        const away = { ...lena, memberships: [{ tenantId: "tenant-a", group: OPERATORS }] };
        const model = build({ keys: [key({ id: "k-left", name: "Left behind", permissions: JSON.stringify(["jobs:execute"]), user: away })] });

        expect(model.keys[0].effective).toEqual([]);
        expect(model.keys[0].paused).toEqual(["jobs:execute"]);
        expect(model.keys[0].owner.groupName).toBeNull();
    });

    it("names the job a key started last", () => {
        expect(build().keys[0].lastRun).toEqual({ job: "Shop nightly", at: "2026-09-29T11:58:00.000Z", status: "Success" });
    });

    it("never takes a run of a deleted key with the same name", () => {
        const model = build({ runs: [{ tenantId: HOME, triggerLabel: "Uptime", startedAt: at("2026-01-02T10:00:00Z"), status: "Failed", job: { name: "CRM daily" } }] });

        expect(model.keys.find((row) => row.name === "Uptime")?.lastRun).toBeNull();
    });

    it("counts what needs a look above the list", () => {
        expect(build().stats).toEqual({
            keys: 4,
            working: 2,
            disabled: 1,
            expired: 1,
            soon: ["Dashboard widget"],
            never: ["Dashboard widget", "Old Jenkins"],
            beyondReading: ["CI pipeline", "Old Jenkins"],
            owners: ["Lena Graf", "Manu"],
        });
    });
});

describe("a key with rights of the platform", () => {
    it("is listed as a platform key while it stores a right on the tenants or the accounts", () => {
        const root = { ...manu, id: "root", platformRole: "ADMIN" };
        const model = build({
            keys: [
                key({ id: "k-msp", name: "MSP automation", permissions: JSON.stringify(["platform-tenants:write", "platform-tenants:read"]), user: root }),
                key({ id: "k-panel", name: "Hosting panel", permissions: JSON.stringify(["platform-sharing:write"]), user: root }),
                key({ id: "k-ci", name: "CI pipeline" }),
            ],
        });
        const platform = (id: string) => model.keys.find((row) => row.id === id)?.platform;

        expect(platform("k-msp")).toBe(true);
        expect(platform("k-panel")).toBe(false);
        expect(platform("k-ci")).toBe(false);
        expect(model.keys.find((row) => row.id === "k-msp")?.effective).toEqual(["platform-tenants:write", "platform-tenants:read"]);
    });
});

describe("the names a key had before", () => {
    it("reads each rename from the audit log with when it happened", () => {
        const audit = [
            { action: "UPDATE", createdAt: at("2026-09-20T10:00:00Z"), details: JSON.stringify({ name: "Deploy", renamedFrom: "CI pipeline", added: [] }) },
            { action: "UPDATE", createdAt: at("2026-09-10T10:00:00Z"), details: JSON.stringify({ name: "CI pipeline", action: "rotate" }) },
            { action: "UPDATE", createdAt: at("2026-08-01T10:00:00Z"), details: JSON.stringify({ name: "CI pipeline", renamedFrom: "Jenkins" }) },
            { action: "CREATE", createdAt: at("2026-06-12T09:00:00Z"), details: JSON.stringify({ name: "Jenkins" }) },
            { action: "UPDATE", createdAt: at("2026-06-13T09:00:00Z"), details: "not json, but \"renamedFrom\"" },
        ];

        expect(formerNames(audit)).toEqual([
            { name: "CI pipeline", until: at("2026-09-20T10:00:00Z") },
            { name: "Jenkins", until: at("2026-08-01T10:00:00Z") },
        ]);
    });
});
