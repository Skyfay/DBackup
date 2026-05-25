import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const {
    mockConnect,
    mockClose,
    mockListCollectionsToArray,
    mockEstimatedCount,
    mockCountDocuments,
    mockFindToArray,
    mockSort,
    mockIsSSHMode,
} = vi.hoisted(() => ({
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockClose: vi.fn().mockResolvedValue(undefined),
    mockListCollectionsToArray: vi.fn().mockResolvedValue([]),
    mockEstimatedCount: vi.fn().mockResolvedValue(0),
    mockCountDocuments: vi.fn().mockResolvedValue(0),
    mockFindToArray: vi.fn().mockResolvedValue([]),
    mockSort: vi.fn(),
    mockIsSSHMode: vi.fn().mockReturnValue(false),
}));

vi.mock("mongodb", () => {
    class MockMongoClient {
        connect() { return mockConnect(); }
        close() { return mockClose(); }
        db(_name: string) {
            const find = {
                sort: (...args: unknown[]) => { mockSort(...args); return find; },
                skip: () => find,
                limit: () => find,
                toArray: () => mockFindToArray(),
            };
            return {
                listCollections: () => ({ toArray: () => mockListCollectionsToArray() }),
                collection: (_coll: string) => ({
                    estimatedDocumentCount: () => mockEstimatedCount(),
                    countDocuments: (filter: unknown) => mockCountDocuments(filter),
                    find: () => find,
                }),
            };
        }
    }
    return { MongoClient: MockMongoClient };
});

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = vi.fn();
        exec = vi.fn();
        end = vi.fn();
    },
    isSSHMode: (...args: unknown[]) => mockIsSSHMode(...args),
    extractSshConfig: vi.fn(),
    buildMongoArgs: vi.fn(() => []),
    remoteBinaryCheck: vi.fn(),
}));

import { getTables, getTableData } from "@/lib/adapters/database/mongodb/browser";

const baseConfig = {
    host: "localhost",
    port: 27017,
};

describe("MongoDB browser - getTables", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns empty list when no collections exist", async () => {
        mockListCollectionsToArray.mockResolvedValue([]);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toEqual([]);
    });

    it("returns collection list with estimated counts", async () => {
        mockListCollectionsToArray.mockResolvedValue([
            { name: "users", type: "collection" },
            { name: "logs", type: "collection" },
        ]);
        mockEstimatedCount.mockResolvedValue(42);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ name: "users", type: "collection", rowCount: 42 });
    });
});

describe("MongoDB browser - getTableData", () => {
    beforeEach(() => vi.clearAllMocks());

    const options = {
        database: "testdb",
        table: "users",
        page: 1,
        pageSize: 10,
    };

    it("returns rows derived from documents", async () => {
        const docs = [
            { _id: "abc", name: "Alice", age: 30 },
            { _id: "def", name: "Bob", age: 25 },
        ];
        mockCountDocuments.mockResolvedValue(2);
        mockFindToArray.mockResolvedValue(docs);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(2);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toMatchObject({ name: "Alice" });
        expect(result.columns.find(c => c.name === "_id")).toMatchObject({ primaryKey: true });
    });

    it("flattens nested objects to JSON strings", async () => {
        const docs = [{ _id: "x", meta: { created: "2024-01-01" } }];
        mockCountDocuments.mockResolvedValue(1);
        mockFindToArray.mockResolvedValue(docs);

        const result = await getTableData(baseConfig as any, options as any);

        expect(typeof result.rows[0].meta).toBe("string");
    });

    it("applies sort when sortBy is provided", async () => {
        mockCountDocuments.mockResolvedValue(0);
        mockFindToArray.mockResolvedValue([]);

        await getTableData(baseConfig as any, { ...options, sortBy: "name", sortDir: "asc" } as any);

        expect(mockSort).toHaveBeenCalledWith({ name: 1 });
    });
});
