import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prismaMock } from "@/lib/testing/prisma-mock";

/**
 * The search of the audit log matches an address only where the row shows it. Nina of the platform
 * works in the tenant of Acme without being a member there, so its log hides her address, and its
 * admin must not find it prefix by prefix through the search either.
 */

const mocks = vi.hoisted(() => ({ tenant: null as string | null }));

vi.mock("@/lib/tenant/current", () => ({ currentTenantId: vi.fn(async () => mocks.tenant) }));
vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: vi.fn(async () => ({ auditLog: 90 })) }));

const { buildAuditWhere } = await import("@/services/audit/audit-query");
const { originShown } = await import("@/services/audit/audit-rows");
const { listAudit, getAuditFacets } = await import("@/services/audit/audit-list-service");
const { auditCsv } = await import("@/services/audit/audit-export");
const { getAuditTimeline } = await import("@/services/audit/audit-timeline");

interface Entry {
    id: string;
    tenantId: string;
    userId: string | null;
    actorName: string | null;
    apiKeyName: string | null;
    ipAddress: string | null;
    resourceId: string | null;
    details: string | null;
    user: { email: string; memberships: { tenantId: string }[] } | null;
}

const NINA = { email: "nina@msp.ch", memberships: [{ tenantId: "default" }] };
const ANNA = { email: "anna@acme.ch", memberships: [{ tenantId: "acme" }] };
const entry = (id: string, tenantId: string, ipAddress: string, who: { userId: string; user: Entry["user"] } | null): Entry => ({
    id,
    tenantId,
    userId: who?.userId ?? null,
    actorName: null,
    apiKeyName: null,
    ipAddress,
    resourceId: null,
    details: null,
    user: who?.user ?? null,
});

const ENTRIES: Entry[] = [
    entry("nina-in-acme", "acme", "10.0.5.7", { userId: "nina", user: NINA }),
    entry("anna-in-acme", "acme", "10.0.5.8", { userId: "anna", user: ANNA }),
    entry("failed-in-acme", "acme", "10.0.5.9", null),
    entry("nina-at-home", "default", "10.0.5.10", { userId: "nina", user: NINA }),
    // Tom of the platform worked in Acme, then his account was deleted and the entry kept his name.
    { ...entry("deleted-tom-in-acme", "acme", "10.0.5.11", null), actorName: "Tom" },
];

/** The part of a Prisma filter the audit search writes, applied to one entry. */
function matches(row: Entry, where: Prisma.AuditLogWhereInput): boolean {
    for (const [key, value] of Object.entries(where)) {
        if (key === "AND") {
            if (!(value as Prisma.AuditLogWhereInput[]).every((part) => matches(row, part))) return false;
        } else if (key === "OR") {
            if (!(value as Prisma.AuditLogWhereInput[]).some((part) => matches(row, part))) return false;
        } else if (key === "user") {
            const is = (value as { is: Record<string, unknown> }).is;
            if (!row.user) return false;
            if ("email" in is && !row.user.email.includes((is.email as { contains: string }).contains)) return false;
            if ("memberships" in is) {
                const wanted = (is.memberships as { some: { tenantId: string } }).some.tenantId;
                if (!row.user.memberships.some((membership) => membership.tenantId === wanted)) return false;
            }
        } else if (value !== null && typeof value === "object" && "contains" in value) {
            const field = row[key as keyof Entry];
            if (typeof field !== "string" || !field.includes((value as { contains: string }).contains)) return false;
        } else if (row[key as keyof Entry] !== value) {
            return false;
        }
    }
    return true;
}

/** Whether the row of an entry shows its address, the rule the search follows. */
const shown = (row: Entry) => originShown(row as unknown as Parameters<typeof originShown>[0]);

const FILTER = { who: [], areas: [], actions: [], quick: "all" as const, period: "all" as const, search: "10.0.5" };
/** The entries a search finds in a log, which the tenant filter has narrowed to one tenant, or every tenant for All tenants. */
const found = (tenant: string | null) =>
    ENTRIES.filter((row) => (tenant ? row.tenantId === tenant : true))
        .filter((row) => matches(row, buildAuditWhere({ ...FILTER, viewerTenantId: tenant }, new Date())))
        .map((row) => row.id);

describe("searching the audit log by an address", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tenant = null;
    });

    it("finds in a customer's log only the entries whose address the log shows", () => {
        expect(found("acme")).toEqual(["anna-in-acme", "failed-in-acme"]);
        for (const row of ENTRIES.filter((entry) => entry.tenantId === "acme")) {
            expect(found("acme").includes(row.id)).toBe(shown(row));
        }
    });

    it("finds every address in the log of the home tenant", () => {
        expect(found("default")).toEqual(["nina-at-home"]);
    });

    it("finds in All tenants only the entries of the home tenant and those without a person", () => {
        expect(found(null)).toEqual(["failed-in-acme", "nina-at-home"]);
        for (const id of found(null)) expect(shown(ENTRIES.find((row) => row.id === id)!)).toBe(true);
    });

    it("finds the address of a deleted account in no customer's log, since nothing tells it worked there", () => {
        expect(found("acme")).not.toContain("deleted-tom-in-acme");
        expect(found(null)).not.toContain("deleted-tom-in-acme");
        expect(shown(ENTRIES.find((row) => row.id === "deleted-tom-in-acme")!)).toBe(false);
    });

    it("finds in a customer's log by email only the people whose origin it shows", () => {
        const byEmail = (search: string) => ENTRIES
            .filter((row) => row.tenantId === "acme" && matches(row, buildAuditWhere({ ...FILTER, search, viewerTenantId: "acme" }, new Date())))
            .map((row) => row.id);

        expect(byEmail("nina@msp")).toEqual([]);
        expect(byEmail("anna@acme")).toEqual(["anna-in-acme"]);
    });

    it("still finds the hidden entries in All tenants by the email of their person, which the platform sees", () => {
        const where = buildAuditWhere({ ...FILTER, search: "nina@msp" }, new Date());
        expect(ENTRIES.filter((row) => row.tenantId === "acme" && matches(row, where)).map((row) => row.id)).toEqual(["nina-in-acme"]);
    });

    it("reads the tenant of the viewer in every list that searches the log", async () => {
        mocks.tenant = "acme";
        prismaMock.auditLog.findMany.mockResolvedValue([]);
        prismaMock.auditLog.count.mockResolvedValue(0);
        const groupBy = prismaMock.auditLog.groupBy as unknown as ReturnType<typeof vi.fn>;
        groupBy.mockResolvedValue([]);
        const query = { ...FILTER, page: 1, pageSize: 20 };
        const memberClause = { tenantId: "acme", user: { is: { memberships: { some: { tenantId: "acme" } } } } };

        await listAudit(query);
        await getAuditFacets(FILTER);
        await auditCsv(FILTER);
        await getAuditTimeline("2026-10-01", "2026-10-02", "UTC", FILTER);

        const wheres = [
            ...prismaMock.auditLog.findMany.mock.calls.map(([args]) => args?.where),
            ...prismaMock.auditLog.count.mock.calls.map(([args]) => args?.where),
            ...groupBy.mock.calls.map(([args]) => (args as { where?: unknown }).where),
        ];
        expect(wheres).toHaveLength(8);
        for (const where of wheres) expect(JSON.stringify(where)).toContain(JSON.stringify(memberClause));
    });
});
