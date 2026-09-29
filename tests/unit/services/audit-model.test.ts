import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { changeSummary, changesOf } from "@/lib/core/audit-changes";
import { diffFields } from "@/lib/core/audit-diff";

vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: vi.fn(async () => ({ auditLog: 90 })) }));

const { buildAuditWhere, whoWhere } = await import("@/services/audit/audit-query");
const { actorOf, networkOf, newPlacesOf } = await import("@/services/audit/audit-rows");
const { csvCell } = await import("@/services/audit/audit-export");
const { parseAuditFilter } = await import("@/services/audit/audit-params");

const NOW = new Date("2026-09-29T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("what the filters of the audit log keep", () => {
    it("reads a person as what they did themselves, their API keys apart", () => {
        expect(whoWhere("user:lena")).toEqual({ userId: "lena", apiKeyId: null });
        expect(whoWhere("key:key-1")).toEqual({ apiKeyId: "key-1" });
        expect(whoWhere("deleted:Kim Frei")).toEqual({ userId: null, actorName: "Kim Frei", apiKeyId: null });
        expect(whoWhere("unknown")).toEqual({ userId: null, actorName: null, apiKeyId: null });
        expect(whoWhere("bogus")).toBeNull();
    });

    it("keeps every value of a filter, not only the first one", () => {
        const where = buildAuditWhere({ who: [], areas: ["jobs", "backups"], actions: ["CREATE", "DELETE"], quick: "all", period: "30d" }, NOW);

        expect(where).toEqual({
            AND: [
                { createdAt: { gte: new Date("2026-08-30T12:00:00Z") } },
                { resource: { in: ["JOB", "BACKUP", "DESTINATION"] } },
                { action: { in: ["CREATE", "DELETE"] } },
            ],
        });
    });

    it("searches the names inside the entries, the address and the email of the person", () => {
        const where = buildAuditWhere({ who: [], areas: [], actions: [], quick: "all", period: "all", search: "Shop nightly" }, NOW) as { AND: { OR?: unknown[] }[] };

        expect(where.AND[0].OR).toContainEqual({ details: { contains: "Shop nightly" } });
        expect(where.AND[0].OR).toContainEqual({ ipAddress: { contains: "Shop nightly" } });
        expect(where.AND[0].OR).toContainEqual({ user: { is: { email: { contains: "Shop nightly" } } } });
    });

    it("counts a filter under the others but itself, and a picked range beats the period", () => {
        const filter = { who: ["user:lena"], areas: [], actions: [], quick: "sensitive" as const, period: "24h" as const, from: at("2026-09-20T00:00:00Z"), to: at("2026-09-21T00:00:00Z") };

        expect(buildAuditWhere(filter, NOW, "who")).toEqual({
            AND: [{ createdAt: { gte: filter.from, lt: filter.to } }, { action: { in: ["EXPORT", "RESTORE"] } }],
        });
    });

    it("turns a day of the timeline into the hours of that day in the time zone of the viewer", () => {
        const filter = parseAuditFilter(new URLSearchParams("fromDay=2026-09-29&toDay=2026-09-29&tz=Europe/Zurich&area=jobs&area=nope"));
        expect(filter).toBeNull();

        const ok = parseAuditFilter(new URLSearchParams("fromDay=2026-09-29&toDay=2026-09-29&tz=Europe/Zurich&who=user:lena&record=JOB:job-1"));
        expect(ok?.from?.toISOString()).toBe("2026-09-28T22:00:00.000Z");
        expect(ok?.to?.toISOString()).toBe("2026-09-29T22:00:00.000Z");
        expect(ok?.record).toEqual({ resource: "JOB", resourceId: "job-1" });
    });
});

describe("who an entry came from", () => {
    const base = { userId: null, actorName: null, apiKeyId: null, apiKeyName: null, action: "UPDATE", details: null, user: null };

    it("names an API key with its owner under it", () => {
        expect(actorOf({ ...base, userId: "manu", apiKeyId: "key-1", apiKeyName: "CI pipeline", user: { name: "Manu", image: null, group: { name: "SuperAdmin" } } })).toMatchObject({
            kind: "key",
            key: "key:key-1",
            name: "CI pipeline",
            sub: "API key of Manu",
        });
    });

    it("keeps the name of a person who was deleted since", () => {
        expect(actorOf({ ...base, actorName: "Kim Frei" })).toMatchObject({ kind: "person", key: "deleted:Kim Frei", name: "Kim Frei", deleted: true });
    });

    it("calls the author of a failed sign-in unknown and names the email it tried", () => {
        expect(actorOf({ ...base, action: "LOGIN_FAILED", details: JSON.stringify({ email: "admin@example.ch" }) })).toMatchObject({ kind: "unknown", name: "Unknown", sub: "admin@example.ch" });
    });
});

describe("a sign-in from a new place", () => {
    beforeEach(() => vi.clearAllMocks());

    it("counts the network, so a new lease in the same place is no new place", () => {
        expect(networkOf("10.0.4.21")).toBe("10.0.4.x");
        expect(networkOf("::ffff:10.0.4.21")).toBe("10.0.4.x");
        expect(networkOf("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::");
        expect(networkOf("unknown")).toBeNull();
    });

    it("marks a network the person never signed in from, but never a first sign-in", async () => {
        prismaMock.auditLog.findMany.mockResolvedValue([
            { userId: "tom", ipAddress: "10.0.4.30", createdAt: at("2026-09-20T08:00:00Z") },
            { userId: "tom", ipAddress: "10.0.4.31", createdAt: at("2026-09-25T08:00:00Z") },
        ] as never);

        const marked = await newPlacesOf([
            { id: "new", action: "LOGIN", userId: "tom", ipAddress: "198.51.100.23", createdAt: at("2026-09-29T12:20:00Z") },
            { id: "known", action: "LOGIN", userId: "tom", ipAddress: "10.0.4.44", createdAt: at("2026-09-29T08:00:00Z") },
            { id: "first", action: "LOGIN", userId: "sara", ipAddress: "203.0.113.9", createdAt: at("2026-09-29T09:00:00Z") },
        ]);

        expect([...marked]).toEqual(["new"]);
    });
});

describe("what an entry says changed", () => {
    it("shows the levels of the areas of a group with the permissions each added", () => {
        const details = { name: "Operators", added: ["storage:download", "storage:restore", "jobs:write"], removed: [], areas: [{ area: "backups", from: "see", to: "use" }, { area: "jobs", from: "use", to: "change" }] };

        expect(changesOf(details)).toEqual([
            { label: "Backups", from: "See", to: "Use", level: true, added: ["Download", "Restore"], removed: [] },
            { label: "Jobs", from: "Use", to: "Change", level: true, added: ["Change jobs"], removed: [] },
        ]);
        expect(changeSummary("UPDATE", details)).toBe("Backups See to Use, Jobs Use to Change");
    });

    it("keeps no value of a secret and says the rest in one line", () => {
        const changes = diffFields(
            { schedule: "03:00", retention: "Keep 7 daily", secret: "a" },
            { schedule: "02:30", retention: "Keep 14 daily", secret: "b" },
            { schedule: { label: "Schedule" }, retention: { label: "Retention" }, secret: { label: "Client secret", secret: true } }
        );

        expect(changes).toEqual([
            { field: "Schedule", from: "03:00", to: "02:30" },
            { field: "Retention", from: "Keep 7 daily", to: "Keep 14 daily" },
            { field: "Client secret", from: null, to: null, secret: true },
        ]);
        expect(changeSummary("UPDATE", { changes })).toBe("Schedule 03:00 to 02:30, Retention Keep 7 daily to Keep 14 daily and 1 more");
    });

    it("sees no change in a list in another order", () => {
        expect(diffFields({ destinations: ["NAS", "S3"] }, { destinations: ["S3", "NAS"] }, { destinations: { label: "Destinations" } })).toEqual([]);
    });

    it("says why a sign-in failed", () => {
        expect(changeSummary("LOGIN_FAILED", { reason: "unknown_email" })).toBe("No account has this email");
        expect(changeSummary("LOGIN_FAILED", { reason: "wrong_password" })).toBe("The password was wrong");
    });
});

describe("the audit log as CSV", () => {
    it("quotes what needs quotes and never lets a spreadsheet run a cell", () => {
        expect(csvCell("Shop nightly")).toBe("Shop nightly");
        expect(csvCell('Changed "Operators", Backups')).toBe('"Changed ""Operators"", Backups"');
        expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
        expect(csvCell(null)).toBe("");
    });
});
