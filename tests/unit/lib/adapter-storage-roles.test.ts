/**
 * Storage adapter roles.
 *
 * A storage config is either a backup destination or a directory source, never both: a
 * destination owns its configured root (the runner writes `<root>/<jobName>/` and chain
 * folders into it) while a source reads folders out of that same root. These tests cover
 * the three places where the exclusivity actually has to hold - the listing filter, the
 * role-change guard, and the clone.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    },
}));

vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn().mockResolvedValue({ userId: "user-1" }),
    checkPermissionWithContext: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));
vi.mock("@/lib/core/audit-types", () => ({ AUDIT_ACTIONS: {}, AUDIT_RESOURCES: {} }));
vi.mock("@/lib/adapters/credential-validation", () => ({ validateCredentialAssignments: vi.fn() }));

vi.mock("@/lib/auth/permissions", () => ({
    PERMISSIONS: {
        DESTINATIONS: { READ: "destinations:read", WRITE: "destinations:write" },
        SOURCES: { VIEW: "sources:view", WRITE: "sources:write" },
        NOTIFICATIONS: { READ: "notifications:read", WRITE: "notifications:write" },
    },
}));

const mockFindMany = vi.fn().mockResolvedValue([]);
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();
const mockJobDestinationFindMany = vi.fn().mockResolvedValue([]);
const mockJobSourceFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findMany: (...args: any[]) => mockFindMany(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
            findFirst: vi.fn().mockResolvedValue(null),
            update: (...args: any[]) => mockUpdate(...args),
            create: (...args: any[]) => mockCreate(...args),
        },
        jobDestination: { findMany: (...args: any[]) => mockJobDestinationFindMany(...args) },
        jobSource: { findMany: (...args: any[]) => mockJobSourceFindMany(...args) },
    },
}));

const { GET } = await import("@/app/api/adapters/route");
const { PUT } = await import("@/app/api/adapters/[id]/route");
const { POST: CLONE } = await import("@/app/api/adapters/[id]/clone/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockJobDestinationFindMany.mockResolvedValue([]);
    mockJobSourceFindMany.mockResolvedValue([]);
});

describe("GET /api/adapters – role filter", () => {
    it("narrows the query to one role when asked", async () => {
        await GET(new NextRequest("http://localhost/api/adapters?type=storage&role=DESTINATION"));

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { type: "storage", storageRole: "DESTINATION" } })
        );
    });

    it("accepts the role case-insensitively, so a hand-written link works", async () => {
        await GET(new NextRequest("http://localhost/api/adapters?type=storage&role=source"));

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { type: "storage", storageRole: "SOURCE" } })
        );
    });

    it("returns both roles when none is given - the job form needs them in one request", async () => {
        await GET(new NextRequest("http://localhost/api/adapters?type=storage"));

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { type: "storage" } })
        );
    });

    it("ignores an unknown role instead of returning nothing", async () => {
        await GET(new NextRequest("http://localhost/api/adapters?type=storage&role=nonsense"));

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { type: "storage" } })
        );
    });
});

describe("PUT /api/adapters/[id] – role change guard", () => {
    const req = (body: unknown) =>
        new NextRequest("http://localhost/api/adapters/a-1", { method: "PUT", body: JSON.stringify(body) });

    it("refuses turning a destination into a source while a job backs up to it", async () => {
        mockFindUnique.mockResolvedValue({ type: "storage", adapterId: "sftp", lastError: null, config: "{}", storageRole: "DESTINATION" });
        mockJobDestinationFindMany.mockResolvedValue([{ job: { name: "Nightly DB" } }]);

        const res = await PUT(req({ name: "NAS", storageRole: "SOURCE" }), params("a-1"));

        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain("Nightly DB");
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("refuses turning a source into a destination while a job reads from it", async () => {
        mockFindUnique.mockResolvedValue({ type: "storage", adapterId: "sftp", lastError: null, config: "{}", storageRole: "SOURCE" });
        mockJobSourceFindMany.mockResolvedValue([{ job: { name: "Scripts Backup" } }]);

        const res = await PUT(req({ name: "Scripts", storageRole: "DESTINATION" }), params("a-1"));

        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain("Scripts Backup");
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("allows the change when nothing references the old role", async () => {
        mockFindUnique.mockResolvedValue({ type: "storage", adapterId: "sftp", lastError: null, config: "{}", storageRole: "DESTINATION" });
        mockUpdate.mockResolvedValue({ id: "a-1", type: "storage", name: "NAS", adapterId: "sftp", config: "{}", createdAt: new Date(), storageRole: "SOURCE" });

        const res = await PUT(req({ name: "NAS", storageRole: "SOURCE" }), params("a-1"));

        expect(res.status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ storageRole: "SOURCE" }) })
        );
    });

    it("does not consult the job tables when the role is unchanged", async () => {
        mockFindUnique.mockResolvedValue({ type: "storage", adapterId: "sftp", lastError: null, config: "{}", storageRole: "DESTINATION" });
        mockUpdate.mockResolvedValue({ id: "a-1", type: "storage", name: "NAS", adapterId: "sftp", config: "{}", createdAt: new Date(), storageRole: "DESTINATION" });

        const res = await PUT(req({ name: "NAS", storageRole: "DESTINATION" }), params("a-1"));

        expect(res.status).toBe(200);
        expect(mockJobDestinationFindMany).not.toHaveBeenCalled();
        expect(mockJobSourceFindMany).not.toHaveBeenCalled();
    });

    it("rejects an unknown role", async () => {
        mockFindUnique.mockResolvedValue({ type: "storage", adapterId: "sftp", lastError: null, config: "{}", storageRole: "DESTINATION" });

        const res = await PUT(req({ name: "NAS", storageRole: "BOTH" }), params("a-1"));

        expect(res.status).toBe(400);
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

describe("POST /api/adapters/[id]/clone – role handling", () => {
    const original = {
        id: "a-1",
        name: "Scripts",
        type: "storage",
        adapterId: "local-filesystem",
        config: "{}",
        metadata: null,
        primaryCredentialId: null,
        sshCredentialId: null,
        storageRole: "SOURCE",
    };
    const req = (body: unknown) =>
        new NextRequest("http://localhost/api/adapters/a-1/clone", { method: "POST", body: JSON.stringify(body) });

    it("keeps the original's role - a cloned source must not come back as a destination", async () => {
        mockFindUnique.mockResolvedValue(original);
        mockCreate.mockResolvedValue({ ...original, id: "a-2", name: "Scripts (Copy)", createdAt: new Date() });

        await CLONE(req({ name: "Scripts (Copy)" }), params("a-1"));

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ storageRole: "SOURCE" }) })
        );
    });

    it("creates the counterpart when an explicit role is given", async () => {
        mockFindUnique.mockResolvedValue(original);
        mockCreate.mockResolvedValue({ ...original, id: "a-2", name: "Scripts (Destination)", storageRole: "DESTINATION", createdAt: new Date() });

        await CLONE(req({ name: "Scripts (Destination)", role: "DESTINATION" }), params("a-1"));

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ storageRole: "DESTINATION", config: original.config }),
            })
        );
    });

    it("rejects an unknown role instead of guessing", async () => {
        mockFindUnique.mockResolvedValue(original);

        const res = await CLONE(req({ name: "Scripts (x)", role: "BOTH" }), params("a-1"));

        expect(res.status).toBe(400);
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
