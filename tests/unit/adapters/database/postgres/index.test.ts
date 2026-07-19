import { describe, it, expect } from "vitest";
import { PostgresAdapter } from "@/lib/adapters/database/postgres/index";

describe("PostgresAdapter", () => {
    it("has the correct id and type", () => {
        expect(PostgresAdapter.id).toBe("postgres");
        expect(PostgresAdapter.type).toBe("database");
    });

    it("has required adapter functions", () => {
        expect(typeof PostgresAdapter.dump).toBe("function");
        expect(typeof PostgresAdapter.dumpOne).toBe("function");
        expect(typeof PostgresAdapter.restore).toBe("function");
        expect(typeof PostgresAdapter.restoreOne).toBe("function");
        expect(typeof PostgresAdapter.test).toBe("function");
        expect(typeof PostgresAdapter.getDatabases).toBe("function");
        expect(typeof PostgresAdapter.getDatabasesWithStats).toBe("function");
        expect(typeof PostgresAdapter.analyzeDump).toBe("function");
        expect(typeof PostgresAdapter.prepareRestore).toBe("function");
    });

    it("exposes a Zod config schema", () => {
        expect(PostgresAdapter.configSchema).toBeDefined();
        expect(typeof PostgresAdapter.configSchema.parse).toBe("function");
    });
});
