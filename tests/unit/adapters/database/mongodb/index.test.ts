import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/adapters/database/mongodb/dump", () => ({
    dump: vi.fn(),
    dumpOne: vi.fn(),
}));
vi.mock("@/lib/adapters/database/mongodb/restore", () => ({
    restore: vi.fn(),
    restoreOne: vi.fn(),
    prepareRestore: vi.fn(),
}));
vi.mock("@/lib/adapters/database/mongodb/connection", () => ({
    test: vi.fn(),
    getDatabases: vi.fn(),
    getDatabasesWithStats: vi.fn(),
}));
vi.mock("@/lib/adapters/database/mongodb/analyze", () => ({
    analyzeDump: vi.fn(),
}));

import { MongoDBAdapter } from "@/lib/adapters/database/mongodb";

describe("MongoDBAdapter", () => {
    it("has correct id and type", () => {
        expect(MongoDBAdapter.id).toBe("mongodb");
        expect(MongoDBAdapter.type).toBe("database");
    });

    it("exposes all required adapter methods", () => {
        expect(typeof MongoDBAdapter.dump).toBe("function");
        expect(typeof MongoDBAdapter.dumpOne).toBe("function");
        expect(typeof MongoDBAdapter.restore).toBe("function");
        expect(typeof MongoDBAdapter.restoreOne).toBe("function");
        expect(typeof MongoDBAdapter.test).toBe("function");
        expect(typeof MongoDBAdapter.getDatabases).toBe("function");
        expect(typeof MongoDBAdapter.getDatabasesWithStats).toBe("function");
        expect(typeof MongoDBAdapter.analyzeDump).toBe("function");
        expect(typeof MongoDBAdapter.prepareRestore).toBe("function");
    });
});
