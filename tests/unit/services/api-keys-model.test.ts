import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: vi.fn() }));

const { buildApiKeysModel } = await import("@/services/auth/api-keys-model");
const { formerNames } = await import("@/services/auth/api-key-details");
type Build = Parameters<typeof buildApiKeysModel>[0];

const NOW = Date.parse("2026-09-29T12:00:00Z");
const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

const OPERATORS = { name: "Operators", permissions: JSON.stringify(["jobs:read", "jobs:execute", "history:read"]) };
const lena = { id: "lena", name: "Lena Graf", email: "lena@example.ch", image: null, group: OPERATORS };
const manu = { id: "manu", name: "Manu", email: "manu@example.ch", image: null, group: { name: "SuperAdmin", permissions: "[]" } };

const key = (overrides: Partial<Build["keys"][number]>): Build["keys"][number] => ({
    id: "key",
    name: "Key",
    prefix: "dbackup_4f1a9c0e",
    permissions: JSON.stringify(["jobs:read"]),
    enabled: true,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: at("2026-06-12T09:00:00Z"),
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
        runs: [{ triggerLabel: "CI pipeline", startedAt: at("2026-09-29T11:58:00Z"), status: "Success", job: { name: "Shop nightly" } }],
        viewer: { id: "lena", superAdmin: false, permissions: ["jobs:read", "jobs:execute", "history:read"] },
        now: NOW,
        ...overrides,
    });
}

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

    it("gives a key of a SuperAdmin all it holds", () => {
        const widget = build().keys.find((row) => row.id === "k-widget");

        expect(widget?.effective).toEqual(["dashboard:read"]);
        expect(widget?.paused).toEqual([]);
    });

    it("names the job a key started last", () => {
        expect(build().keys[0].lastRun).toEqual({ job: "Shop nightly", at: "2026-09-29T11:58:00.000Z", status: "Success" });
    });

    it("never takes a run of a deleted key with the same name", () => {
        const model = build({ runs: [{ triggerLabel: "Uptime", startedAt: at("2026-01-02T10:00:00Z"), status: "Failed", job: { name: "CRM daily" } }] });

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
